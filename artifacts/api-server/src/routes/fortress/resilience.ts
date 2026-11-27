import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  AddSignerBody,
  CountersignCheckpointBody,
  CreateCheckpointBody,
  ImportCheckpointBody,
  MergeRevocationsBody,
  RevokeSignerBody,
  SubmitWitnessBody,
} from "@workspace/api-zod";
import {
  countersign,
  merge,
  validateRevocationState,
  verifyCheckpoint,
  verifyWitness,
  type RevocationState,
  type SignedCheckpoint,
  type Tombstone,
} from "@workspace/fortress-core";
import { fail } from "../../fortress/errors";
import { ctx, handler, iso, isoReq, parseBody, parseId } from "../../fortress/http";
import { requireAdmin } from "../../fortress/auth";
import { appendEvent, loadManifest, recordCondition } from "../../fortress/ledger";
import { runIdempotent, withTransaction } from "../../fortress/tx";
import { getSigner, installationName } from "../../fortress/keys";
import { requireConsent } from "../../fortress/protection";
import { createLocalCheckpoint, serializeCheckpoint } from "../../fortress/checkpoints";
import { addTombstone } from "../../fortress/recoveryOps";

const router: IRouter = Router();

router.get("/v1/resilience/checkpoints", handler(async (_req, res) => {
  const r = await pool.query<Record<string, unknown>>(
    "SELECT * FROM fortress_checkpoints WHERE tenant_id = $1 ORDER BY height DESC, created_at DESC LIMIT 100",
    [ctx(res).tenantId],
  );
  res.json(await Promise.all(r.rows.map((row) => serializeCheckpoint(pool, row))));
}));

router.post("/v1/resilience/checkpoints", requireAdmin, handler(async (req, res) => {
  const body = parseBody(CreateCheckpointBody, req);
  const c = ctx(res);
  const row = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "create_checkpoint", idempotencyKey: body.idempotencyKey, fingerprint: {} },
    async (client, key) => (await createLocalCheckpoint(client, c.tenantId, c.userId, key)).row,
  );
  res.json(await serializeCheckpoint(pool, row));
}));

function serializeSigner(row: Record<string, unknown>) {
  return {
    id: String(row.id), keyId: String(row.key_id), kind: String(row.kind) as "peer" | "witness" | "seamcraft_sender",
    label: String(row.label), createdAt: isoReq(row.created_at as Date), revokedAt: iso(row.revoked_at as Date | null),
  };
}

router.get("/v1/resilience/signers", handler(async (_req, res) => {
  const r = await pool.query<Record<string, unknown>>("SELECT * FROM fortress_trusted_signers WHERE tenant_id = $1 ORDER BY created_at", [ctx(res).tenantId]);
  res.json({ installationKey: getSigner().keyId, signers: r.rows.map(serializeSigner) });
}));

router.post("/v1/resilience/signers", requireAdmin, handler(async (req, res) => {
  const body = parseBody(AddSignerBody, req);
  const c = ctx(res);
  if (body.keyId === getSigner().keyId) throw fail(400, "BAD_REQUEST", "That is this installation's own key.");
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "add_signer", idempotencyKey: body.idempotencyKey, fingerprint: body },
    async (client, key) => {
      const tomb = await client.query("SELECT 1 FROM fortress_revocation_tombstones WHERE tenant_id = $1 AND kind = 'trusted_signer' AND item_id = $2", [c.tenantId, `${body.kind}:${body.keyId}`]);
      if (tomb.rows.length) throw fail(409, "CONFLICT", "This key was revoked. Revocation is permanent; use a new key.");
      const r = await client.query<Record<string, unknown>>(
        `INSERT INTO fortress_trusted_signers (tenant_id, key_id, kind, label) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, kind, key_id) DO NOTHING RETURNING *`,
        [c.tenantId, body.keyId, body.kind, body.label],
      );
      if (!r.rows[0]) throw fail(409, "CONFLICT", "This key is already registered for that role.");
      await appendEvent(client, c.tenantId, { eventType: "TRUSTED_SIGNER_ADDED", actorId: c.userId, idempotencyKey: key, meta: { keyId: body.keyId, kind: body.kind } });
      return serializeSigner(r.rows[0]);
    },
  );
  res.json(result);
}));

router.post("/v1/resilience/signers/:id/revoke", requireAdmin, handler(async (req, res) => {
  const id = parseId(req);
  const body = parseBody(RevokeSignerBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "revoke_signer", idempotencyKey: body.idempotencyKey, fingerprint: { id } },
    async (client, key) => {
      const r = await client.query<Record<string, unknown>>(
        "UPDATE fortress_trusted_signers SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING *",
        [id, c.tenantId],
      );
      if (!r.rows[0]) throw fail(404, "NOT_FOUND", "Active signer not found.");
      await addTombstone(client, c.tenantId, "trusted_signer", `${String(r.rows[0].kind)}:${String(r.rows[0].key_id)}`, installationName());
      await appendEvent(client, c.tenantId, { eventType: "TRUSTED_SIGNER_REVOKED", actorId: c.userId, idempotencyKey: key, meta: { keyId: r.rows[0].key_id, kind: r.rows[0].kind },
        // Withdrawing trust is a recovery step: allowed while RECOVERY_REQUIRED.
        skipIntegrityGate: true });
      return serializeSigner(r.rows[0]);
    },
  );
  res.json(result);
}));

async function activeKeys(tenantId: string, kind: string): Promise<string[]> {
  const r = await pool.query<{ key_id: string }>(
    "SELECT key_id FROM fortress_trusted_signers WHERE tenant_id = $1 AND kind = $2 AND revoked_at IS NULL",
    [tenantId, kind],
  );
  return r.rows.map((x) => x.key_id);
}

/** Store a registered witness's countersignature on one of our checkpoints. */
router.post("/v1/resilience/witnesses", requireAdmin, handler(async (req, res) => {
  const body = parseBody(SubmitWitnessBody, req);
  const c = ctx(res);
  const witnesses = await activeKeys(c.tenantId, "witness");
  const row = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "submit_witness", idempotencyKey: body.idempotencyKey, fingerprint: body.witness },
    async (client, key) => {
      await requireConsent(client, c.tenantId, "witness_sharing");
      const cp = await client.query<Record<string, unknown>>(
        "SELECT * FROM fortress_checkpoints WHERE tenant_id = $1 AND checkpoint_hash = $2 AND source = 'local'",
        [c.tenantId, body.witness.checkpoint_hash],
      );
      if (!cp.rows[0]) throw fail(404, "NOT_FOUND", "No local checkpoint with that hash.");
      if (!verifyWitness(body.witness, body.witness.checkpoint_hash, witnesses)) {
        throw fail(403, "FORBIDDEN", "Witness signature is invalid or the witness key is not registered.");
      }
      await client.query(
        "INSERT INTO fortress_witnesses (tenant_id, checkpoint_hash, witness_key, signature) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [c.tenantId, body.witness.checkpoint_hash, body.witness.witness, body.witness.signature],
      );
      await appendEvent(client, c.tenantId, {
        eventType: "CHECKPOINT_WITNESSED", actorId: c.userId, idempotencyKey: key, objectRef: body.witness.checkpoint_hash,
        meta: { witness: body.witness.witness },
      });
      return cp.rows[0];
    },
  );
  res.json(await serializeCheckpoint(pool, row as Record<string, unknown>));
}));

/** Act as a witness for a registered peer installation's checkpoint. */
router.post("/v1/resilience/countersign", requireAdmin, handler(async (req, res) => {
  const body = parseBody(CountersignCheckpointBody, req);
  const c = ctx(res);
  const peers = await activeKeys(c.tenantId, "peer");
  const signed = body.signed as unknown as SignedCheckpoint;
  const check = verifyCheckpoint(signed, peers);
  if (!check.ok) throw fail(403, "FORBIDDEN", `Peer checkpoint rejected (${check.code}).`);
  const out = await withTransaction(async (client) => {
    await requireConsent(client, c.tenantId, "witness_sharing");
    const sig = countersign(getSigner(), signed);
    await appendEvent(client, c.tenantId, {
      eventType: "PEER_CHECKPOINT_COUNTERSIGNED", actorId: c.userId, objectRef: signed.checkpoint_hash,
      meta: { peer: signed.checkpoint.signer, height: signed.checkpoint.height },
    });
    return sig;
  });
  res.json(out);
}));

/**
 * Import a checkpoint about this tenant's chain from outside (a peer, an old
 * .pfr, an anchor). A checkpoint that disagrees with local history, or that is
 * beyond the local tip (rollback / truncation), puts the tenant into
 * RECOVERY_REQUIRED instead of being silently ignored.
 */
router.post("/v1/resilience/import", requireAdmin, handler(async (req, res) => {
  const body = parseBody(ImportCheckpointBody, req);
  const c = ctx(res);
  const signed = body.signed as unknown as SignedCheckpoint;
  const manifest = await loadManifest(pool, c.tenantId);
  const trusted = [manifest.trust_key, ...(await activeKeys(c.tenantId, "peer"))];
  const check = verifyCheckpoint(signed, trusted);
  if (!check.ok) throw fail(403, "FORBIDDEN", `Checkpoint rejected (${check.code}).`);
  if (signed.checkpoint.chain_id !== manifest.chain_id) throw fail(400, "BAD_REQUEST", "Checkpoint belongs to a different chain.");
  const local = await pool.query<{ head_idx: number }>("SELECT head_idx FROM fortress_tenants WHERE id = $1", [c.tenantId]);
  const localHeight = Number(local.rows[0]!.head_idx);
  const at = await pool.query<{ hash: string }>("SELECT hash FROM fortress_events WHERE tenant_id = $1 AND idx = $2", [c.tenantId, signed.checkpoint.height]);
  if (signed.checkpoint.height > localHeight || !at.rows[0]) {
    await recordCondition(c.tenantId, "CHECKPOINT_BEYOND_TIP", {
      ref: signed.checkpoint_hash, origin: body.origin, height: signed.checkpoint.height, localHeight,
      checkpointHash: signed.checkpoint_hash, signed,
    });
    throw fail(409, "CHECKPOINT_CONTRADICTION", "That checkpoint is ahead of local history. Local data may have been rolled back. Recovery is required.");
  }
  if (at.rows[0].hash !== signed.checkpoint.tip_hash) {
    await recordCondition(c.tenantId, "CHECKPOINT_CONTRADICTION", {
      ref: signed.checkpoint_hash, origin: body.origin, height: signed.checkpoint.height,
      checkpointHash: signed.checkpoint_hash, signed,
    });
    throw fail(409, "CHECKPOINT_CONTRADICTION", "That checkpoint contradicts local history. Recovery is required.");
  }
  await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "import_checkpoint", idempotencyKey: body.idempotencyKey, fingerprint: { h: signed.checkpoint_hash } },
    async (client, key) => {
      await client.query(
        `INSERT INTO fortress_checkpoints (tenant_id, height, tip_hash, checkpoint_hash, body, signature, signer, source, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'imported',$8) ON CONFLICT (tenant_id, checkpoint_hash) DO NOTHING`,
        [c.tenantId, signed.checkpoint.height, signed.checkpoint.tip_hash, signed.checkpoint_hash, JSON.stringify(signed.checkpoint), signed.signature, signed.checkpoint.signer, body.origin],
      );
      await appendEvent(client, c.tenantId, {
        eventType: "CHECKPOINT_IMPORTED", actorId: c.userId, idempotencyKey: key, objectRef: signed.checkpoint_hash,
        meta: { origin: body.origin, height: signed.checkpoint.height, consistent: true },
      });
      return { ok: true };
    },
  );
  res.json({ status: "consistent", height: signed.checkpoint.height, localHeight, checkpointHash: signed.checkpoint_hash });
}));

async function revocationState(tenantId: string): Promise<RevocationState> {
  const r = await pool.query<{ kind: Tombstone["kind"]; item_id: string; revoked_at_us: string; origin: string }>(
    "SELECT kind, item_id, revoked_at_us, origin FROM fortress_revocation_tombstones WHERE tenant_id = $1",
    [tenantId],
  );
  const state: RevocationState = {};
  for (const t of r.rows) state[`${t.kind}:${t.item_id}`] = { kind: t.kind, id: t.item_id, revoked_at_us: Number(t.revoked_at_us), origin: t.origin };
  return state;
}

router.get("/v1/resilience/revocations", handler(async (_req, res) => {
  res.json({ origin: installationName(), state: await revocationState(ctx(res).tenantId) });
}));

/** Merge a peer's revocation set. Revocation always wins; nothing is ever granted by a merge. */
router.post("/v1/resilience/revocations/merge", requireAdmin, handler(async (req, res) => {
  const body = parseBody(MergeRevocationsBody, req);
  const c = ctx(res);
  let incoming: RevocationState;
  try {
    incoming = validateRevocationState(body.state);
  } catch (err) {
    throw fail(400, "BAD_REQUEST", `Revocation state is invalid (${(err as Error).message}).`);
  }
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "merge_revocations", idempotencyKey: body.idempotencyKey, fingerprint: { n: Object.keys(incoming).length } },
    async (client, key) => {
      const before = await revocationState(c.tenantId);
      const merged = merge(before, incoming);
      let added = 0;
      let applied = 0;
      for (const [k, t] of Object.entries(merged)) {
        if (k in before) continue;
        added += 1;
        await client.query(
          `INSERT INTO fortress_revocation_tombstones (tenant_id, kind, item_id, revoked_at_us, origin)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [c.tenantId, t.kind, t.id, t.revoked_at_us, t.origin],
        );
        let r;
        if (t.kind === "credential" && /^[0-9a-f-]{36}$/.test(t.id)) {
          r = await client.query("UPDATE fortress_credentials SET revoked = true WHERE tenant_id = $1 AND id = $2 AND revoked = false", [c.tenantId, t.id]);
        } else if (t.kind === "recovery_contact" && /^[0-9a-f-]{36}$/.test(t.id)) {
          r = await client.query("UPDATE fortress_contacts SET status = 'removed', removed_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'active'", [c.tenantId, t.id]);
        } else if (t.kind === "consent") {
          r = await client.query("UPDATE fortress_consents SET state = 'withdrawn', version = version + 1, updated_by = $3, updated_at = now() WHERE tenant_id = $1 AND purpose = $2 AND state = 'granted'", [c.tenantId, t.id, `merge:${t.origin}`]);
        } else if (t.kind === "trusted_signer") {
          const [kind, ...rest] = t.id.split(":");
          r = await client.query("UPDATE fortress_trusted_signers SET revoked_at = now() WHERE tenant_id = $1 AND kind = $2 AND key_id = $3 AND revoked_at IS NULL", [c.tenantId, kind, rest.join(":")]);
        }
        applied += r?.rowCount ?? 0;
      }
      await appendEvent(client, c.tenantId, { eventType: "REVOCATIONS_MERGED", actorId: c.userId, idempotencyKey: key, meta: { added, applied } });
      return { added, applied, total: Object.keys(merged).length };
    },
  );
  res.json(result);
}));

export default router;
