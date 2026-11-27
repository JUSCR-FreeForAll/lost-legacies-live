import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  AddContactBody,
  ConfirmRecoveryKeyBody,
  ConfirmRecoveryRotationBody,
  EmergencyRecoverBody,
  RegenerateRecoveryCodesBody,
  RemoveContactBody,
  RevokeSessionsBody,
  RotateRecoveryKeyBody,
  StartCeremonyBody,
  CancelCeremonyBody,
  CompleteCeremonyBody,
  UpdateRecoveryPolicyBody,
} from "@workspace/api-zod";
import { buildPfr, digestsEqual, sha256Hex, type CiphertextEnvelope, type PfrVaultItem } from "@workspace/fortress-core";
import { fail } from "../../fortress/errors";
import { ctx, handler, iso, isoReq, parseBody, parseId, type Services } from "../../fortress/http";
import { requireAdmin, requireOwner } from "../../fortress/auth";
import { appendEvent, loadBlocks, loadManifest } from "../../fortress/ledger";
import { runIdempotent, withTransaction } from "../../fortress/tx";
import { throttle } from "../../fortress/throttle";
import { getSigner, installationName } from "../../fortress/keys";
import { notify, requireConsent } from "../../fortress/protection";
import { createLocalCheckpoint } from "../../fortress/checkpoints";
import { addTombstone, codeHash, emergencyReset, issueRecoveryCodes, markSessionsRevoked } from "../../fortress/recoveryOps";
import { revokeProviderSessions } from "../../fortress/sessions";
import {
  backupContext,
  decodePresentedKey,
  evidenceContext,
  generateRecoveryKey,
  openRecoveryKey,
  recoveryKeyFingerprint,
  rewrapAll,
  rowCiphertext,
  sealRecoveryKey,
} from "../../fortress/vault";

/**
 * Responses that carry one-time secrets are saved without them. A replay of
 * the same idempotency key must neither re-issue nor pretend to, so it is
 * refused and the caller is told to start a new request.
 */
function refuseSecretReplay<T>(_saved: T): T {
  throw fail(409, "SECRET_ALREADY_ISSUED", "This request already completed and its secret was shown once. Start a new request to get a new one.");
}

export function recoveryRouter(services: Services): IRouter {
  const router: IRouter = Router();

  async function policy(tenantId: string) {
    const r = await pool.query<{ recovery_threshold: number; recovery_delay_hours: number; active: string }>(
      `SELECT recovery_threshold, recovery_delay_hours,
        (SELECT count(*) FROM fortress_contacts WHERE tenant_id = $1 AND status = 'active') AS active
       FROM fortress_tenants WHERE id = $1`,
      [tenantId],
    );
    const row = r.rows[0]!;
    return { threshold: Number(row.recovery_threshold), delayHours: Number(row.recovery_delay_hours), activeContacts: Number(row.active) };
  }

  router.get("/v1/recovery/status", handler(async (_req, res) => {
    const c = ctx(res);
    const t = await pool.query<{ key_status: string; key_fingerprint: string | null; pending_mode: string | null; pending_expires_at: Date | null }>(
      "SELECT key_status, key_fingerprint, pending_mode, pending_expires_at FROM fortress_tenants WHERE id = $1",
      [c.tenantId],
    );
    const codes = await pool.query<{ total: string; remaining: string; created: Date | null }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE used_at IS NULL) AS remaining, max(created_at) AS created
       FROM fortress_recovery_codes WHERE tenant_id = $1 AND user_id = $2 AND voided_at IS NULL`,
      [c.tenantId, c.userId],
    );
    const row = t.rows[0]!;
    const pendingLive = row.pending_expires_at && row.pending_expires_at.getTime() > Date.now();
    res.json({
      status: row.key_status,
      fingerprint: row.key_fingerprint,
      pendingMode: pendingLive ? row.pending_mode : null,
      pendingExpiresAt: pendingLive ? iso(row.pending_expires_at) : null,
      codesRemaining: Number(codes.rows[0]!.remaining),
      codesTotal: Number(codes.rows[0]!.total),
      codesCreatedAt: iso(codes.rows[0]!.created),
      policy: await policy(c.tenantId),
    });
  }));

  router.post("/v1/recovery/setup", requireAdmin, handler(async (_req, res) => {
    const c = ctx(res);
    const key = generateRecoveryKey();
    const fingerprint = recoveryKeyFingerprint(key);
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    await withTransaction(async (client) => {
      const cur = await client.query<{ key_status: string }>("SELECT key_status FROM fortress_tenants WHERE id = $1 FOR UPDATE", [c.tenantId]);
      if (cur.rows[0]?.key_status === "active") throw fail(409, "CONFLICT", "A recovery key is already active. Use rotation instead.");
      await client.query(
        `UPDATE fortress_tenants SET pending_fingerprint = $2, pending_envelope = $3, pending_mode = 'setup',
           pending_expires_at = $4, key_status = 'pending' WHERE id = $1`,
        [c.tenantId, fingerprint, JSON.stringify(sealRecoveryKey(key, c.tenantId)), expiresAt],
      );
      await appendEvent(client, c.tenantId, {
        eventType: "RECOVERY_KEY_ISSUED", actorId: c.userId,
        meta: { fingerprint, expiresAt: expiresAt.toISOString(), oneTimeDisplay: true },
      });
    });
    const text = key.toString("base64");
    key.fill(0);
    res.json({ status: "pending_setup", recoveryKey: text, fingerprint, expiresAt: expiresAt.toISOString() });
  }));

  async function confirmPending(tenantId: string, userId: string, mode: "setup" | "rotation", presented: string, idempotencyKey: string) {
    const presentedKey = decodePresentedKey(presented);
    return runIdempotent(
      {
        tenantId, actorId: userId, route: `confirm_${mode}`, idempotencyKey,
        fingerprint: { keyHash: sha256Hex(presentedKey) },
      },
      async (client, key) => {
        const t = await client.query<{
          key_envelope: CiphertextEnvelope | null; key_fingerprint: string | null;
          pending_fingerprint: string | null; pending_envelope: CiphertextEnvelope | null;
          pending_mode: string | null; pending_expires_at: Date | null;
        }>(
          `SELECT key_envelope, key_fingerprint, pending_fingerprint, pending_envelope, pending_mode, pending_expires_at
           FROM fortress_tenants WHERE id = $1 FOR UPDATE`,
          [tenantId],
        );
        const row = t.rows[0]!;
        if (!row.pending_envelope || row.pending_mode !== mode || !row.pending_fingerprint) {
          throw fail(409, "CONFLICT", "There is no matching pending recovery-key operation.");
        }
        if (!row.pending_expires_at || row.pending_expires_at.getTime() <= Date.now()) {
          throw fail(409, "CONFLICT", "The pending recovery-key operation expired. Start again.");
        }
        const pendingKey = openRecoveryKey(row.pending_envelope, tenantId);
        if (pendingKey.length !== presentedKey.length || !timingSafeEqual(pendingKey, presentedKey)) {
          throw fail(403, "RECOVERY_KEY_INVALID", "Recovery-key confirmation did not match.").withAudit({
            tenantId, actorId: userId, eventType: "RECOVERY_CONFIRMATION_FAILED", meta: { mode },
          });
        }
        let rewrapped: Record<string, number> = {};
        if (mode === "rotation") {
          if (!row.key_envelope) throw fail(409, "RECOVERY_KEY_NOT_ACTIVE", "No active recovery key exists to rotate.");
          const oldKey = openRecoveryKey(row.key_envelope, tenantId);
          rewrapped = await rewrapAll(client, tenantId, oldKey, pendingKey);
          oldKey.fill(0);
        }
        pendingKey.fill(0);
        await client.query(
          `UPDATE fortress_tenants SET key_fingerprint = pending_fingerprint, key_envelope = pending_envelope, key_status = 'active',
             pending_fingerprint = NULL, pending_envelope = NULL, pending_mode = NULL, pending_expires_at = NULL WHERE id = $1`,
          [tenantId],
        );
        await appendEvent(client, tenantId, {
          eventType: mode === "setup" ? "RECOVERY_KEY_ACTIVATED" : "RECOVERY_KEY_ROTATED",
          actorId: userId, idempotencyKey: key,
          meta: { fingerprint: row.pending_fingerprint, previousFingerprint: row.key_fingerprint, rewrapped },
        });
        if (mode === "rotation") await notify(client, tenantId, userId, "recovery_key.rotated", { fingerprint: row.pending_fingerprint });
        return { status: "active" as const, fingerprint: row.pending_fingerprint };
      },
    ).finally(() => presentedKey.fill(0));
  }

  router.post("/v1/recovery/confirm", requireAdmin, handler(async (req, res) => {
    const body = parseBody(ConfirmRecoveryKeyBody, req);
    const c = ctx(res);
    res.json(await confirmPending(c.tenantId, c.userId, "setup", body.recoveryKey, body.idempotencyKey));
  }));

  router.post("/v1/recovery/rotate/confirm", requireAdmin, handler(async (req, res) => {
    const body = parseBody(ConfirmRecoveryRotationBody, req);
    const c = ctx(res);
    res.json(await confirmPending(c.tenantId, c.userId, "rotation", body.recoveryKey, body.idempotencyKey));
  }));

  router.post("/v1/recovery/rotate", requireAdmin, handler(async (req, res) => {
    const body = parseBody(RotateRecoveryKeyBody, req);
    const c = ctx(res);
    await throttle(`rotate:${c.tenantId}`, 5, 60 * 60_000);
    const presented = decodePresentedKey(body.currentRecoveryKey);
    const next = generateRecoveryKey();
    const fingerprint = recoveryKeyFingerprint(next);
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    // Idempotent: a replay never issues a second key. The saved response has
    // the secret stripped, so a replay is refused rather than returning it.
    const result = await runIdempotent(
      {
        tenantId: c.tenantId, actorId: c.userId, route: "rotate_recovery_key", idempotencyKey: body.idempotencyKey,
        fingerprint: { keyHash: sha256Hex(presented) },
      },
      async (client, ikey) => {
      const t = await client.query<{ key_status: string; key_envelope: CiphertextEnvelope | null; key_fingerprint: string | null }>(
        "SELECT key_status, key_envelope, key_fingerprint FROM fortress_tenants WHERE id = $1 FOR UPDATE",
        [c.tenantId],
      );
      const row = t.rows[0]!;
      if (row.key_status !== "active" || !row.key_envelope) throw fail(409, "RECOVERY_KEY_NOT_ACTIVE", "There is no active recovery key to rotate.");
      const current = openRecoveryKey(row.key_envelope, c.tenantId);
      const ok = current.length === presented.length && timingSafeEqual(current, presented);
      current.fill(0);
      if (!ok) {
        throw fail(403, "RECOVERY_KEY_INVALID", "Current recovery key did not match.").withAudit({
          tenantId: c.tenantId, actorId: c.userId, eventType: "RECOVERY_ROTATION_FAILED", meta: { reason: "current_key_mismatch" },
        });
      }
      await client.query(
        `UPDATE fortress_tenants SET pending_fingerprint = $2, pending_envelope = $3, pending_mode = 'rotation', pending_expires_at = $4 WHERE id = $1`,
        [c.tenantId, fingerprint, JSON.stringify(sealRecoveryKey(next, c.tenantId)), expiresAt],
      );
      await appendEvent(client, c.tenantId, {
        eventType: "RECOVERY_ROTATION_ISSUED", actorId: c.userId, idempotencyKey: ikey,
        meta: { previousFingerprint: row.key_fingerprint, fingerprint, expiresAt: expiresAt.toISOString() },
      });
      return { status: "pending_rotation" as const, recoveryKey: next.toString("base64") as string | null, fingerprint, expiresAt: expiresAt.toISOString() };
      },
      refuseSecretReplay,
    ).finally(() => {
      presented.fill(0);
      next.fill(0);
    });
    res.json(result);
  }));

  router.post("/v1/recovery/codes", requireOwner, handler(async (req, res) => {
    const body = parseBody(RegenerateRecoveryCodesBody, req);
    const c = ctx(res);
    const result = await runIdempotent(
      { tenantId: c.tenantId, actorId: c.userId, route: "regenerate_codes", idempotencyKey: body.idempotencyKey, fingerprint: {} },
      async (client, ikey) => {
        const issued = await issueRecoveryCodes(client, c.tenantId, c.userId);
        await appendEvent(client, c.tenantId, {
          eventType: "RECOVERY_CODES_ISSUED", actorId: c.userId, idempotencyKey: ikey,
          meta: { batchId: issued.batchId, count: issued.codes.length },
        });
        await notify(client, c.tenantId, c.userId, "recovery.codes.regenerated", { count: issued.codes.length });
        return issued;
      },
      refuseSecretReplay,
    );
    res.json(result);
  }));

  router.post("/v1/recovery/emergency", requireOwner, handler(async (req, res) => {
    const body = parseBody(EmergencyRecoverBody, req);
    const c = ctx(res);
    await throttle(`emergency:${c.userId}`, 5, 15 * 60_000);
    const hash = codeHash(c.tenantId, c.userId, body.recoveryCode);
    const result = await runIdempotent(
      { tenantId: c.tenantId, actorId: c.userId, route: "emergency", idempotencyKey: body.idempotencyKey, fingerprint: { codeHash: hash ?? "invalid" } },
      async (client) => {
        const audit = { tenantId: c.tenantId, actorId: c.userId, eventType: "RECOVERY_CODE_REJECTED", meta: {} };
        if (!hash) throw fail(403, "RECOVERY_CODE_INVALID", "That recovery code is not valid.").withAudit(audit);
        const found = await client.query<{ id: string; code_hash: string }>(
          `SELECT id, code_hash FROM fortress_recovery_codes
           WHERE tenant_id = $1 AND user_id = $2 AND used_at IS NULL AND voided_at IS NULL FOR UPDATE`,
          [c.tenantId, c.userId],
        );
        const match = found.rows.find((r) => digestsEqual(r.code_hash, hash));
        if (!match) throw fail(403, "RECOVERY_CODE_INVALID", "That recovery code is not valid or was already used.").withAudit(audit);
        await client.query("UPDATE fortress_recovery_codes SET used_at = now() WHERE id = $1", [match.id]);
        await notify(client, c.tenantId, c.userId, "recovery.code.used", { remaining: found.rows.length - 1 });
        return emergencyReset(client, c.tenantId, c.userId, c.sessionId, "recovery_code", installationName());
      },
    );
    // A replay carries no secrets (they were shown once); do not reveal or redo anything.
    if (result.recoveryKey === null && result.newCodes.length === 0) {
      throw fail(409, "SECRET_ALREADY_ISSUED", "This recovery was already completed and its new key and codes were shown once. Use a new code to start again.");
    }
    const provider = await revokeProviderSessions(services.sessionRevoker, c.userId);
    res.json({ ...result, providerSessionsRevoked: provider.revoked, providerRevocationPending: provider.pending });
  }));

  router.post("/v1/security/sessions/revoke", handler(async (req, res) => {
    const body = parseBody(RevokeSessionsBody, req);
    const c = ctx(res);
    await withTransaction(async (client) => {
      await markSessionsRevoked(client, c.userId, c.sessionId);
      await appendEvent(client, c.tenantId, {
        eventType: "SESSIONS_REVOKED", actorId: c.userId, idempotencyKey: body.idempotencyKey,
        meta: { provider: services.sessionRevoker.name }, skipIntegrityGate: true,
      });
    });
    const provider = await revokeProviderSessions(services.sessionRevoker, c.userId);
    await withTransaction((client) => notify(client, c.tenantId, c.userId, "recovery.sessions.revoked", { count: provider.revoked }));
    if (provider.pending) {
      req.log.warn("Provider session revocation incomplete; local cutoff applies and a retry is scheduled");
      throw fail(502, "PROVIDER_REVOCATION_FAILED",
        "Other sessions are blocked here, but the sign-in provider did not confirm ending all of them. It will keep retrying; you can also try again.");
    }
    res.json({ revokedAt: new Date().toISOString(), providerSessionsRevoked: provider.revoked, provider: services.sessionRevoker.name });
  }));

  router.get("/v1/recovery/package", requireAdmin, handler(async (_req, res) => {
    const c = ctx(res);
    const pkg = await withTransaction(async (client) => {
      const { signed } = await createLocalCheckpoint(client, c.tenantId, c.userId, null);
      const manifest = await loadManifest(client, c.tenantId);
      const blocks = (await loadBlocks(client, c.tenantId)).slice(0, signed.checkpoint.height + 1);
      const fp = await client.query<{ key_fingerprint: string | null }>("SELECT key_fingerprint FROM fortress_tenants WHERE id = $1", [c.tenantId]);
      const items: PfrVaultItem[] = [];
      const backups = await client.query<Record<string, unknown>>(
        `SELECT b.*, d.name AS dataset_name FROM fortress_backups b JOIN fortress_datasets d ON d.id = b.dataset_id
         WHERE b.tenant_id = $1 AND b.payload_status = 'retained' ORDER BY b.created_at`,
        [c.tenantId],
      );
      for (const b of backups.rows) {
        const { ciphertext, wrapped } = rowCiphertext(b);
        items.push({
          id: String(b.id), kind: "backup", context: backupContext(c.tenantId, String(b.id)), checksum: String(b.checksum),
          bytes: Number(b.bytes), created_at: (b.created_at as Date).toISOString(), label: `${String(b.dataset_name)} v${String(b.version)}`,
          ciphertext, wrapped_data_key: wrapped,
        });
      }
      const evidence = await client.query<Record<string, unknown>>(
        "SELECT * FROM fortress_evidence WHERE tenant_id = $1 AND status = 'retained' ORDER BY created_at",
        [c.tenantId],
      );
      for (const e of evidence.rows) {
        const { ciphertext, wrapped } = rowCiphertext(e);
        items.push({
          id: String(e.id), kind: "evidence", context: evidenceContext(c.tenantId, String(e.id)), checksum: String(e.checksum),
          bytes: Number(e.bytes), created_at: (e.created_at as Date).toISOString(), label: String(e.label),
          ciphertext, wrapped_data_key: wrapped,
        });
      }
      await appendEvent(client, c.tenantId, {
        eventType: "RECOVERY_PACKAGE_EXPORTED", actorId: c.userId, objectRef: signed.checkpoint_hash,
        meta: { items: items.length, height: signed.checkpoint.height },
      });
      return buildPfr(getSigner(), {
        chainManifest: manifest, blocks, checkpoint: signed, items, recoveryKeyFingerprint: fp.rows[0]?.key_fingerprint ?? null,
      });
    });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="phoenix-fortress-${new Date().toISOString().slice(0, 10)}.pfr"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(pkg);
  }));

  // ---- Recovery contacts, quorum and delay -------------------------------

  function serializeContact(row: Record<string, unknown>) {
    return {
      id: String(row.id), label: String(row.label), contactUserId: String(row.contact_user_id),
      status: String(row.status) as "active" | "removed", createdAt: isoReq(row.created_at as Date),
    };
  }

  router.get("/v1/recovery/contacts", handler(async (_req, res) => {
    const r = await pool.query<Record<string, unknown>>(
      "SELECT * FROM fortress_contacts WHERE tenant_id = $1 ORDER BY created_at",
      [ctx(res).tenantId],
    );
    res.json(r.rows.map(serializeContact));
  }));

  router.post("/v1/recovery/contacts", requireOwner, handler(async (req, res) => {
    const body = parseBody(AddContactBody, req);
    const c = ctx(res);
    if (body.contactUserId === c.userId) throw fail(400, "BAD_REQUEST", "You cannot be your own recovery contact.");
    const result = await runIdempotent(
      { tenantId: c.tenantId, actorId: c.userId, route: "add_contact", idempotencyKey: body.idempotencyKey, fingerprint: body },
      async (client, key) => {
        await requireConsent(client, c.tenantId, "recovery_contacts");
        const dup = await client.query("SELECT 1 FROM fortress_contacts WHERE tenant_id = $1 AND contact_user_id = $2 AND status = 'active'", [c.tenantId, body.contactUserId]);
        if (dup.rows.length) throw fail(409, "CONFLICT", "This person is already an active contact.");
        const r = await client.query<Record<string, unknown>>(
          "INSERT INTO fortress_contacts (tenant_id, contact_user_id, label) VALUES ($1,$2,$3) RETURNING *",
          [c.tenantId, body.contactUserId, body.label],
        );
        const active = await client.query<{ n: string }>("SELECT count(*) AS n FROM fortress_contacts WHERE tenant_id = $1 AND status = 'active'", [c.tenantId]);
        await appendEvent(client, c.tenantId, { eventType: "RECOVERY_CONTACT_ADDED", actorId: c.userId, idempotencyKey: key, meta: { contactId: r.rows[0]!.id } });
        await notify(client, c.tenantId, c.userId, "recovery.contact.changed", { active: Number(active.rows[0]!.n) });
        return serializeContact(r.rows[0]!);
      },
    );
    res.json(result);
  }));

  router.post("/v1/recovery/contacts/:id/remove", requireOwner, handler(async (req, res) => {
    const id = parseId(req);
    const body = parseBody(RemoveContactBody, req);
    const c = ctx(res);
    const result = await runIdempotent(
      { tenantId: c.tenantId, actorId: c.userId, route: "remove_contact", idempotencyKey: body.idempotencyKey, fingerprint: { id } },
      async (client, key) => {
        const r = await client.query<Record<string, unknown>>(
          "UPDATE fortress_contacts SET status = 'removed', removed_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'active' RETURNING *",
          [id, c.tenantId],
        );
        if (!r.rows[0]) throw fail(404, "NOT_FOUND", "Active contact not found.");
        await addTombstone(client, c.tenantId, "recovery_contact", id, installationName());
        await appendEvent(client, c.tenantId, { eventType: "RECOVERY_CONTACT_REMOVED", actorId: c.userId, idempotencyKey: key, meta: { contactId: id } });
        // Policy: the removed contact is never notified. Only the owner's inbox changes.
        const active = await client.query<{ n: string }>("SELECT count(*) AS n FROM fortress_contacts WHERE tenant_id = $1 AND status = 'active'", [c.tenantId]);
        await notify(client, c.tenantId, c.userId, "recovery.contact.changed", { active: Number(active.rows[0]!.n) });
        return serializeContact(r.rows[0]);
      },
    );
    res.json(result);
  }));

  router.put("/v1/recovery/policy", requireOwner, handler(async (req, res) => {
    const body = parseBody(UpdateRecoveryPolicyBody, req);
    const c = ctx(res);
    await runIdempotent(
      { tenantId: c.tenantId, actorId: c.userId, route: "recovery_policy", idempotencyKey: body.idempotencyKey, fingerprint: body },
      async (client, key) => {
        const active = await client.query<{ n: string }>("SELECT count(*) AS n FROM fortress_contacts WHERE tenant_id = $1 AND status = 'active'", [c.tenantId]);
        if (body.threshold > Number(active.rows[0]!.n)) {
          throw fail(409, "CONFLICT", `The approval threshold (${body.threshold}) cannot exceed your active contacts (${active.rows[0]!.n}).`);
        }
        await client.query("UPDATE fortress_tenants SET recovery_threshold = $2, recovery_delay_hours = $3 WHERE id = $1", [c.tenantId, body.threshold, body.delayHours]);
        await appendEvent(client, c.tenantId, { eventType: "RECOVERY_POLICY_UPDATED", actorId: c.userId, idempotencyKey: key, meta: { threshold: body.threshold, delayHours: body.delayHours } });
        return { ok: true };
      },
    );
    res.json(await policy(c.tenantId));
  }));

  async function serializeCeremony(row: Record<string, unknown>) {
    const a = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM fortress_approvals a JOIN fortress_contacts k ON k.id = a.contact_id
       WHERE a.ceremony_id = $1 AND k.status = 'active'`,
      [row.id],
    );
    const expired = row.status === "pending" && new Date(row.expires_at as Date).getTime() <= Date.now();
    return {
      id: String(row.id),
      status: (expired ? "expired" : String(row.status)) as "pending" | "cancelled" | "completed" | "expired",
      threshold: Number(row.threshold),
      approvals: Number(a.rows[0]!.n),
      readyAt: isoReq(row.ready_at as Date),
      expiresAt: isoReq(row.expires_at as Date),
      createdAt: isoReq(row.created_at as Date),
      completedAt: iso(row.completed_at as Date | null),
    };
  }

  router.get("/v1/recovery/ceremonies", handler(async (_req, res) => {
    const r = await pool.query<Record<string, unknown>>("SELECT * FROM fortress_ceremonies WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50", [ctx(res).tenantId]);
    res.json(await Promise.all(r.rows.map(serializeCeremony)));
  }));

  router.post("/v1/recovery/ceremonies", requireOwner, handler(async (req, res) => {
    const body = parseBody(StartCeremonyBody, req);
    const c = ctx(res);
    const result = await runIdempotent(
      { tenantId: c.tenantId, actorId: c.userId, route: "start_ceremony", idempotencyKey: body.idempotencyKey, fingerprint: {} },
      async (client, key) => {
        await requireConsent(client, c.tenantId, "recovery_contacts");
        const p = await client.query<{ recovery_threshold: number; recovery_delay_hours: number }>(
          "SELECT recovery_threshold, recovery_delay_hours FROM fortress_tenants WHERE id = $1", [c.tenantId]);
        const threshold = Number(p.rows[0]!.recovery_threshold);
        const delay = Math.max(24, Number(p.rows[0]!.recovery_delay_hours));
        const contacts = await client.query<{ contact_user_id: string }>("SELECT contact_user_id FROM fortress_contacts WHERE tenant_id = $1 AND status = 'active'", [c.tenantId]);
        if (contacts.rows.length < threshold) throw fail(409, "CONFLICT", `You need at least ${threshold} active recovery contacts.`);
        const open = await client.query("SELECT 1 FROM fortress_ceremonies WHERE tenant_id = $1 AND status = 'pending' AND expires_at > now()", [c.tenantId]);
        if (open.rows.length) throw fail(409, "CONFLICT", "A recovery request is already in progress.");
        const readyAt = new Date(Date.now() + delay * 3_600_000);
        const expiresAt = new Date(readyAt.getTime() + 7 * 86_400_000);
        const r = await client.query<Record<string, unknown>>(
          "INSERT INTO fortress_ceremonies (tenant_id, initiated_by, threshold, ready_at, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
          [c.tenantId, c.userId, threshold, readyAt, expiresAt],
        );
        await appendEvent(client, c.tenantId, {
          eventType: "RECOVERY_CEREMONY_STARTED", actorId: c.userId, idempotencyKey: key,
          meta: { ceremonyId: r.rows[0]!.id, threshold, delayHours: delay },
        });
        await notify(client, c.tenantId, c.userId, "recovery.ceremony.started", { ready_at: readyAt.toISOString() });
        for (const k of contacts.rows) await notify(client, c.tenantId, k.contact_user_id, "recovery.ceremony.approval_requested");
        return r.rows[0]!;
      },
    );
    res.json(await serializeCeremony(result as Record<string, unknown>));
  }));

  router.post("/v1/recovery/ceremonies/:id/cancel", requireOwner, handler(async (req, res) => {
    const id = parseId(req);
    const body = parseBody(CancelCeremonyBody, req);
    const c = ctx(res);
    const row = await runIdempotent(
      { tenantId: c.tenantId, actorId: c.userId, route: "cancel_ceremony", idempotencyKey: body.idempotencyKey, fingerprint: { id } },
      async (client, key) => {
        const r = await client.query<Record<string, unknown>>(
          "UPDATE fortress_ceremonies SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2 AND status = 'pending' RETURNING *",
          [id, c.tenantId],
        );
        if (!r.rows[0]) throw fail(404, "NOT_FOUND", "Pending recovery request not found.");
        await appendEvent(client, c.tenantId, { eventType: "RECOVERY_CEREMONY_CANCELLED", actorId: c.userId, idempotencyKey: key, meta: { ceremonyId: id } });
        await notify(client, c.tenantId, c.userId, "recovery.ceremony.cancelled");
        return r.rows[0];
      },
    );
    res.json(await serializeCeremony(row as Record<string, unknown>));
  }));

  router.post("/v1/recovery/ceremonies/:id/complete", requireOwner, handler(async (req, res) => {
    const id = parseId(req);
    const body = parseBody(CompleteCeremonyBody, req);
    const c = ctx(res);
    const result = await runIdempotent(
      { tenantId: c.tenantId, actorId: c.userId, route: "complete_ceremony", idempotencyKey: body.idempotencyKey, fingerprint: { id } },
      async (client) => {
        const r = await client.query<Record<string, unknown>>(
          "SELECT * FROM fortress_ceremonies WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
          [id, c.tenantId],
        );
        const cer = r.rows[0];
        if (!cer || cer.status !== "pending") throw fail(404, "NOT_FOUND", "Pending recovery request not found.");
        // Consent may have been withdrawn during the waiting period.
        await requireConsent(client, c.tenantId, "recovery_contacts");
        if (new Date(cer.expires_at as Date).getTime() <= Date.now()) throw fail(409, "CONFLICT", "This recovery request expired. Start a new one.");
        if (new Date(cer.ready_at as Date).getTime() > Date.now()) {
          throw fail(409, "CONFLICT", `The waiting period has not ended. It ends at ${isoReq(cer.ready_at as Date)}.`);
        }
        const a = await client.query<{ n: string }>(
          `SELECT count(*) AS n FROM fortress_approvals a JOIN fortress_contacts k ON k.id = a.contact_id
           WHERE a.ceremony_id = $1 AND k.status = 'active'`,
          [id],
        );
        if (Number(a.rows[0]!.n) < Number(cer.threshold)) {
          throw fail(409, "CONFLICT", `Only ${a.rows[0]!.n} of ${String(cer.threshold)} required approvals so far.`);
        }
        await client.query("UPDATE fortress_ceremonies SET status = 'completed', completed_at = now() WHERE id = $1", [id]);
        await notify(client, c.tenantId, c.userId, "recovery.ceremony.completed");
        return emergencyReset(client, c.tenantId, c.userId, c.sessionId, "contact_ceremony", installationName());
      },
    );
    if (result.recoveryKey === null && result.newCodes.length === 0) {
      throw fail(409, "SECRET_ALREADY_ISSUED", "This recovery was already completed and its new key and codes were shown once.");
    }
    const provider = await revokeProviderSessions(services.sessionRevoker, c.userId);
    res.json({ ...result, providerSessionsRevoked: provider.revoked, providerRevocationPending: provider.pending });
  }));

  return router;
}

/** Helper (recovery contact) endpoints. Not tenant-scoped: the caller is a contact, not a member. */
export function helperRouter(): IRouter {
  const router: IRouter = Router();
  router.get("/v1/helper/requests", handler(async (_req, res) => {
    const userId = res.locals.userId as string;
    const r = await pool.query<Record<string, unknown>>(
      `SELECT c.id AS ceremony_id, c.status, c.ready_at, c.expires_at, k.label, k.id AS contact_id,
         EXISTS (SELECT 1 FROM fortress_approvals a WHERE a.ceremony_id = c.id AND a.contact_id = k.id) AS approved
       FROM fortress_ceremonies c JOIN fortress_contacts k ON k.tenant_id = c.tenant_id
       WHERE k.contact_user_id = $1 AND k.status = 'active' AND c.status = 'pending' AND c.expires_at > now()
       ORDER BY c.created_at DESC`,
      [userId],
    );
    res.json(r.rows.map((x) => ({
      ceremonyId: String(x.ceremony_id), contactLabel: String(x.label), status: String(x.status),
      approved: Boolean(x.approved), readyAt: isoReq(x.ready_at as Date), expiresAt: isoReq(x.expires_at as Date),
    })));
  }));

  router.post("/v1/helper/requests/:id/approve", handler(async (req, res) => {
    const id = parseId(req);
    const userId = res.locals.userId as string;
    await throttle(`approve:${userId}`, 20, 60 * 60_000);
    const out = await withTransaction(async (client) => {
      const r = await client.query<Record<string, unknown>>(
        `SELECT c.*, k.id AS contact_id, k.label FROM fortress_ceremonies c
         JOIN fortress_contacts k ON k.tenant_id = c.tenant_id AND k.contact_user_id = $2 AND k.status = 'active'
         WHERE c.id = $1 AND c.status = 'pending' AND c.expires_at > now() FOR UPDATE OF c`,
        [id, userId],
      );
      const row = r.rows[0];
      if (!row) throw fail(404, "NOT_FOUND", "Recovery request not found.");
      const ins = await client.query(
        "INSERT INTO fortress_approvals (ceremony_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING ceremony_id",
        [id, row.contact_id],
      );
      if (ins.rows.length) {
        await appendEvent(client, String(row.tenant_id), {
          eventType: "RECOVERY_CEREMONY_APPROVED", actorId: `contact:${String(row.contact_id)}`,
          meta: { ceremonyId: id, contactId: String(row.contact_id) },
        });
      }
      return row;
    });
    res.json({
      ceremonyId: id, contactLabel: String(out.label), status: "pending", approved: true,
      readyAt: isoReq(out.ready_at as Date), expiresAt: isoReq(out.expires_at as Date),
    });
  }));
  return router;
}
