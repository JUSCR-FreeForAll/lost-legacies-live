import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  DeleteEvidenceBody,
  MarkNotificationsReadBody,
  SetConsentBody,
  StoreEvidenceBody,
  UpdateSafetyBody,
} from "@workspace/api-zod";
import { MESSAGES, isMessageId, renderMessage, type Locale } from "@workspace/fortress-core";
import { fail } from "../../fortress/errors";
import { ctx, handler, isoReq, iso, parseBody, parseId } from "../../fortress/http";
import { requireOwner } from "../../fortress/auth";
import { appendEvent } from "../../fortress/ledger";
import { runIdempotent, withTransaction } from "../../fortress/tx";
import { installationName } from "../../fortress/keys";
import { CONSENT_PURPOSES, isConsentPurpose, notify, requireConsent } from "../../fortress/protection";
import { addTombstone } from "../../fortress/recoveryOps";
import { evidenceContext, getRecoveryKey, openRow, seal, sealedColumns } from "../../fortress/vault";

const router: IRouter = Router();

async function consentRows(tenantId: string) {
  const r = await pool.query<{ purpose: string; state: string; version: number; updated_at: Date }>(
    "SELECT purpose, state, version, updated_at FROM fortress_consents WHERE tenant_id = $1",
    [tenantId],
  );
  const byPurpose = new Map(r.rows.map((x) => [x.purpose, x]));
  return Object.entries(CONSENT_PURPOSES).map(([purpose, description]) => {
    const row = byPurpose.get(purpose);
    return {
      purpose: purpose as keyof typeof CONSENT_PURPOSES,
      state: (row?.state ?? "never_asked") as "granted" | "withdrawn" | "never_asked",
      version: Number(row?.version ?? 0),
      updatedAt: iso(row?.updated_at ?? null),
      description,
    };
  });
}

router.get("/v1/consents", handler(async (_req, res) => {
  res.json(await consentRows(ctx(res).tenantId));
}));

router.put("/v1/consents/:purpose", requireOwner, handler(async (req, res) => {
  const purpose = String(req.params.purpose);
  if (!isConsentPurpose(purpose)) throw fail(400, "BAD_REQUEST", "Unknown consent purpose.");
  const body = parseBody(SetConsentBody, req);
  const c = ctx(res);
  await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "set_consent", idempotencyKey: body.idempotencyKey, fingerprint: { purpose, state: body.state } },
    async (client, key) => {
      await client.query(
        `INSERT INTO fortress_consents (tenant_id, purpose, state, version, updated_by, updated_at)
         VALUES ($1,$2,$3,1,$4,now())
         ON CONFLICT (tenant_id, purpose) DO UPDATE SET state = $3, version = fortress_consents.version + 1, updated_by = $4, updated_at = now()`,
        [c.tenantId, purpose, body.state, c.userId],
      );
      if (body.state === "withdrawn") await addTombstone(client, c.tenantId, "consent", purpose, installationName());
      else await client.query("DELETE FROM fortress_revocation_tombstones WHERE tenant_id = $1 AND kind = 'consent' AND item_id = $2 AND origin = $3", [c.tenantId, purpose, installationName()]);
      await appendEvent(client, c.tenantId, { eventType: "CONSENT_CHANGED", actorId: c.userId, idempotencyKey: key, meta: { purpose, state: body.state } });
      await notify(client, c.tenantId, c.userId, "consent.changed", { purpose, state: body.state });
      return { ok: true };
    },
  );
  res.json((await consentRows(c.tenantId)).find((x) => x.purpose === purpose));
}));

function serializeEvidence(row: Record<string, unknown>) {
  return {
    id: String(row.id), label: String(row.label), checksum: String(row.checksum), bytes: Number(row.bytes),
    status: String(row.status) as "retained" | "deleted", createdAt: isoReq(row.created_at as Date),
  };
}

router.get("/v1/evidence", handler(async (_req, res) => {
  const r = await pool.query<Record<string, unknown>>("SELECT * FROM fortress_evidence WHERE tenant_id = $1 ORDER BY created_at DESC", [ctx(res).tenantId]);
  res.json(r.rows.map(serializeEvidence));
}));

router.post("/v1/evidence", requireOwner, handler(async (req, res) => {
  const body = parseBody(StoreEvidenceBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "store_evidence", idempotencyKey: body.idempotencyKey, fingerprint: { label: body.label, len: body.content.length } },
    async (client, key) => {
      await requireConsent(client, c.tenantId, "evidence_storage");
      const master = await getRecoveryKey(client, c.tenantId);
      const id = randomUUID();
      const sealed = seal(Buffer.from(body.content, "utf8"), master, evidenceContext(c.tenantId, id));
      master.fill(0);
      const r = await client.query<Record<string, unknown>>(
        `INSERT INTO fortress_evidence (id, tenant_id, label, checksum, ciphertext, nonce, tag, wrapped_data_key, data_key_nonce, data_key_tag, bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [id, c.tenantId, body.label, ...sealedColumns(sealed), sealed.bytes],
      );
      // The label is user text: the ledger records only the id and checksum.
      await appendEvent(client, c.tenantId, {
        eventType: "EVIDENCE_STORED", actorId: c.userId, idempotencyKey: key, objectRef: `sha256:${sealed.checksum}`,
        meta: { evidenceId: id, bytes: sealed.bytes },
      });
      await notify(client, c.tenantId, c.userId, "evidence.stored");
      return serializeEvidence(r.rows[0]!);
    },
  );
  res.json(result);
}));

router.get("/v1/evidence/:id/data", requireOwner, handler(async (req, res) => {
  const id = parseId(req);
  const c = ctx(res);
  const client = await pool.connect();
  try {
    const r = await client.query<Record<string, unknown>>("SELECT * FROM fortress_evidence WHERE id = $1 AND tenant_id = $2 AND status = 'retained'", [id, c.tenantId]);
    const row = r.rows[0];
    if (!row) throw fail(404, "NOT_FOUND", "Evidence not found.");
    const key = await getRecoveryKey(client, c.tenantId);
    const bytes = openRow(row, key, evidenceContext(c.tenantId, id));
    key.fill(0);
    res.setHeader("Cache-Control", "no-store");
    res.json({ id, checksum: String(row.checksum), content: bytes.toString("utf8") });
  } finally {
    client.release();
  }
}));

router.post("/v1/evidence/:id/delete", requireOwner, handler(async (req, res) => {
  const id = parseId(req);
  const body = parseBody(DeleteEvidenceBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "delete_evidence", idempotencyKey: body.idempotencyKey, fingerprint: { id } },
    async (client, key) => {
      const r = await client.query<Record<string, unknown>>(
        `UPDATE fortress_evidence SET status = 'deleted', label = '[deleted]', ciphertext = NULL, nonce = NULL, tag = NULL,
           wrapped_data_key = NULL, data_key_nonce = NULL, data_key_tag = NULL
         WHERE id = $1 AND tenant_id = $2 AND status = 'retained' RETURNING *`,
        [id, c.tenantId],
      );
      if (!r.rows[0]) throw fail(404, "NOT_FOUND", "Evidence not found.");
      await appendEvent(client, c.tenantId, { eventType: "EVIDENCE_DELETED", actorId: c.userId, idempotencyKey: key, meta: { evidenceId: id, cryptoShredded: true } });
      return serializeEvidence(r.rows[0]);
    },
  );
  res.json(result);
}));

router.get("/v1/notifications", handler(async (_req, res) => {
  const c = ctx(res);
  const t = await pool.query<{ locale: Locale }>("SELECT locale FROM fortress_tenants WHERE id = $1", [c.tenantId]);
  const locale = t.rows[0]?.locale ?? "en";
  const r = await pool.query<{ id: string; message_id: string; vars: Record<string, string | number>; created_at: Date; read_at: Date | null }>(
    `SELECT id, message_id, vars, created_at, read_at FROM fortress_notifications
     WHERE recipient_user_id = $1 AND suppressed = false ORDER BY created_at DESC LIMIT 100`,
    [c.userId],
  );
  res.json(r.rows.filter((n) => isMessageId(n.message_id)).map((n) => {
    const id = n.message_id as keyof typeof MESSAGES;
    return {
      id: n.id, messageId: id, text: renderMessage(id, locale, n.vars), severity: MESSAGES[id].severity,
      createdAt: n.created_at.toISOString(), read: n.read_at !== null,
    };
  }));
}));

router.post("/v1/notifications/read", handler(async (req, res) => {
  parseBody(MarkNotificationsReadBody, req);
  const r = await pool.query(
    "UPDATE fortress_notifications SET read_at = now() WHERE recipient_user_id = $1 AND read_at IS NULL",
    [ctx(res).userId],
  );
  res.json({ count: r.rowCount ?? 0 });
}));

router.put("/v1/safety", handler(async (req, res) => {
  const body = parseBody(UpdateSafetyBody, req);
  const c = ctx(res);
  await withTransaction(async (client) => {
    await client.query(
      "UPDATE fortress_tenants SET safe_mode = $2, locale = $3, notification_mode = $4 WHERE id = $1",
      [c.tenantId, body.safeMode, body.locale, body.notificationMode],
    );
    await appendEvent(client, c.tenantId, {
      eventType: "SAFETY_SETTINGS_CHANGED", actorId: c.userId, idempotencyKey: body.idempotencyKey,
      meta: { safeMode: body.safeMode, locale: body.locale, notificationMode: body.notificationMode },
      skipIntegrityGate: true,
    });
  });
  res.json({ safeMode: body.safeMode, locale: body.locale, notificationMode: body.notificationMode });
}));

export default router;
