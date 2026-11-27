import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { ImportJsonLdBody, ImportSeamcraftBody, PrepareAnchorBody, RecordAnchorBody } from "@workspace/api-zod";
import {
  AdapterError,
  anchorMemo,
  buildAnchorCommitment,
  canonicalize,
  createSeamcraftAdapter,
  isSolanaSignature,
  jsonLdAdapter,
  sha256Ref,
  unsignedEnvelope,
  type FortressAdapter,
  type SeamcraftEnvelope,
  type SignedCheckpoint,
} from "@workspace/fortress-core";
import { fail, type ApiError } from "../../fortress/errors";
import { ctx, handler, iso, isoReq, parseBody, parseId } from "../../fortress/http";
import { requireAdmin } from "../../fortress/auth";
import { appendEvent, loadManifest, rowToSignedCheckpoint } from "../../fortress/ledger";
import { runIdempotent } from "../../fortress/tx";
import { grantedPurposes } from "../../fortress/protection";
import type { Tx } from "../../fortress/tx";

const router: IRouter = Router();

function serializeRecord(row: Record<string, unknown>, replay: boolean) {
  return {
    id: String(row.id),
    adapter: String(row.adapter) as "jsonld" | "seamcraft",
    objectRef: String(row.object_ref),
    meta: row.meta as Record<string, unknown>,
    eventIdx: Number(row.event_idx),
    createdAt: isoReq(row.created_at as Date),
    replay,
  };
}

function adapterFailure(err: unknown): ApiError {
  if (err instanceof AdapterError) {
    if (err.code === "PAYLOAD_TOO_LARGE") return fail(413, "PAYLOAD_TOO_LARGE", "Envelope exceeds 64 KiB.");
    return fail(422, "ADAPTER_REJECTED", `${err.code}: ${err.message}`);
  }
  throw err;
}

/**
 * Shared adapter pipeline: validate → authorize (consent, trust) →
 * canonicalize → atomic commit. Adapters never see keys and cannot skip
 * the ledger, consent registry or idempotency.
 */
async function runAdapter<V>(
  adapter: FortressAdapter<V>,
  raw: Buffer,
  c: ReturnType<typeof ctx>,
  idempotencyKey: string,
  beforeCommit?: (client: Tx, validated: V) => Promise<void>,
  objectRefOverride?: (validated: V) => string,
) {
  let validated: V;
  let event;
  try {
    validated = adapter.validate(raw);
  } catch (err) {
    throw adapterFailure(err);
  }
  const granted = await grantedPurposes(pool, c.tenantId);
  const decision = adapter.authorize(validated, { userId: c.userId, role: c.role, tenantId: c.tenantId }, { granted });
  if (!decision.allow) {
    if (decision.code === "CONSENT_REQUIRED") throw fail(403, "CONSENT_REQUIRED", decision.message);
    throw fail(403, "FORBIDDEN", decision.message);
  }
  try {
    event = await adapter.canonicalEvent(validated);
  } catch (err) {
    throw adapterFailure(err);
  }
  const objectRef = objectRefOverride ? objectRefOverride(validated) : event.objectRef;
  let replay = true;
  const row = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: `interop_${adapter.name}`, idempotencyKey, fingerprint: { objectRef } },
    async (client, key) => {
      // Re-authorize inside the committing transaction (tenant row is locked),
      // so consent or trust withdrawn after the first check is honoured.
      const grantedNow = await grantedPurposes(client, c.tenantId);
      const again = adapter.authorize(validated, { userId: c.userId, role: c.role, tenantId: c.tenantId }, { granted: grantedNow });
      if (!again.allow) {
        if (again.code === "CONSENT_REQUIRED") throw fail(403, "CONSENT_REQUIRED", again.message);
        throw fail(403, "FORBIDDEN", again.message);
      }
      // Replay checks (Seamcraft nonces) run first so a resubmitted envelope is
      // rejected outright rather than answered from the earlier record.
      if (beforeCommit) await beforeCommit(client, validated);
      const existing = await client.query<Record<string, unknown>>(
        "SELECT * FROM fortress_interop_records WHERE tenant_id = $1 AND adapter = $2 AND object_ref = $3",
        [c.tenantId, adapter.name, objectRef],
      );
      if (existing.rows[0]) return existing.rows[0];
      replay = false;
      const block = await appendEvent(client, c.tenantId, {
        eventType: event.eventType, actorId: c.userId, idempotencyKey: key, objectRef, meta: event.meta as never,
      });
      const r = await client.query<Record<string, unknown>>(
        `INSERT INTO fortress_interop_records (tenant_id, adapter, object_ref, canonical, meta, event_idx)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [c.tenantId, adapter.name, objectRef, event.canonicalPayload.toString("utf8"), JSON.stringify(event.meta), block.idx],
      );
      return r.rows[0]!;
    },
  );
  return serializeRecord(row, replay);
}

router.get("/v1/interop/records", handler(async (_req, res) => {
  const r = await pool.query<Record<string, unknown>>(
    "SELECT * FROM fortress_interop_records WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200",
    [ctx(res).tenantId],
  );
  res.json(r.rows.map((row) => serializeRecord(row, false)));
}));

router.post("/v1/interop/jsonld", handler(async (req, res) => {
  const body = parseBody(ImportJsonLdBody, req);
  const c = ctx(res);
  res.json(await runAdapter(jsonLdAdapter, Buffer.from(JSON.stringify(body.document), "utf8"), c, body.idempotencyKey));
}));

router.post("/v1/interop/seamcraft", handler(async (req, res) => {
  const body = parseBody(ImportSeamcraftBody, req);
  const c = ctx(res);
  const manifest = await loadManifest(pool, c.tenantId);
  const senders = await pool.query<{ key_id: string }>(
    "SELECT key_id FROM fortress_trusted_signers WHERE tenant_id = $1 AND kind = 'seamcraft_sender' AND revoked_at IS NULL",
    [c.tenantId],
  );
  const adapter = createSeamcraftAdapter({ recipient: manifest.chain_id, trustedSenders: senders.rows.map((s) => s.key_id) });
  const raw = Buffer.from(JSON.stringify(body.envelope), "utf8");
  res.json(await runAdapter(
    adapter,
    raw,
    c,
    body.idempotencyKey,
    async (client, v) => {
      const still = await client.query(
        "SELECT 1 FROM fortress_trusted_signers WHERE tenant_id = $1 AND kind = 'seamcraft_sender' AND key_id = $2 AND revoked_at IS NULL",
        [c.tenantId, v.envelope.sender],
      );
      if (!still.rows.length) throw fail(403, "FORBIDDEN", "That Seamcraft sender is no longer trusted.");
      const ins = await client.query(
        "INSERT INTO fortress_seamcraft_nonces (tenant_id, sender, nonce) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING nonce",
        [c.tenantId, v.envelope.sender, v.envelope.nonce],
      );
      if (!ins.rows.length) throw fail(409, "REPLAY_REJECTED", "This envelope nonce was already used by that sender.");
    },
    (v) => sha256Ref(canonicalize(unsignedEnvelope(v.envelope as SeamcraftEnvelope))),
  ));
}));

function serializeAnchor(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    checkpointHash: String(row.checkpoint_hash),
    commitment: row.commitment as Record<string, unknown>,
    memo: String(row.memo),
    status: String(row.status) as "prepared" | "recorded_unverified",
    network: (row.network as string | null) ?? null,
    txSignature: (row.tx_signature as string | null) ?? null,
    createdAt: isoReq(row.created_at as Date),
    recordedAt: iso(row.recorded_at as Date | null),
  };
}

router.get("/v1/anchors", handler(async (_req, res) => {
  const c = ctx(res);
  const granted = await grantedPurposes(pool, c.tenantId);
  const r = await pool.query<Record<string, unknown>>("SELECT * FROM fortress_anchors WHERE tenant_id = $1 ORDER BY created_at DESC", [c.tenantId]);
  res.json({
    enabled: granted.has("external_anchor"),
    consent: granted.has("external_anchor") ? "granted" : "not_granted",
    anchors: r.rows.map(serializeAnchor),
  });
}));

router.post("/v1/anchors", requireAdmin, handler(async (req, res) => {
  const body = parseBody(PrepareAnchorBody, req);
  const c = ctx(res);
  const row = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "prepare_anchor", idempotencyKey: body.idempotencyKey, fingerprint: {} },
    async (client, key) => {
      const granted = await grantedPurposes(client, c.tenantId);
      if (!granted.has("external_anchor")) throw fail(403, "CONSENT_REQUIRED", "Grant the external_anchor consent before preparing an anchor.");
      const cp = await client.query<Record<string, unknown>>(
        "SELECT * FROM fortress_checkpoints WHERE tenant_id = $1 AND source = 'local' ORDER BY height DESC, created_at DESC LIMIT 1",
        [c.tenantId],
      );
      if (!cp.rows[0]) throw fail(409, "CONFLICT", "Create a signed checkpoint first.");
      const signed: SignedCheckpoint = rowToSignedCheckpoint(cp.rows[0]);
      const commitment = buildAnchorCommitment(signed);
      const memo = anchorMemo(commitment);
      const r = await client.query<Record<string, unknown>>(
        "INSERT INTO fortress_anchors (tenant_id, checkpoint_hash, commitment, memo) VALUES ($1,$2,$3,$4) RETURNING *",
        [c.tenantId, signed.checkpoint_hash, JSON.stringify(commitment), memo],
      );
      await appendEvent(client, c.tenantId, {
        eventType: "ANCHOR_PREPARED", actorId: c.userId, idempotencyKey: key, objectRef: signed.checkpoint_hash,
        meta: { anchorId: String(r.rows[0]!.id), height: commitment.height },
      });
      return r.rows[0]!;
    },
  );
  res.json(serializeAnchor(row));
}));

router.post("/v1/anchors/:id/record", requireAdmin, handler(async (req, res) => {
  const id = parseId(req);
  const body = parseBody(RecordAnchorBody, req);
  const c = ctx(res);
  if (!isSolanaSignature(body.txSignature)) throw fail(400, "BAD_REQUEST", "That is not a Solana transaction signature.");
  const row = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "record_anchor", idempotencyKey: body.idempotencyKey, fingerprint: { id, ...body } },
    async (client, key) => {
      const granted = await grantedPurposes(client, c.tenantId);
      if (!granted.has("external_anchor")) throw fail(403, "CONSENT_REQUIRED", "The external_anchor consent was withdrawn. Grant it again before recording an anchor.");
      const r = await client.query<Record<string, unknown>>(
        `UPDATE fortress_anchors SET status = 'recorded_unverified', network = $3, tx_signature = $4, recorded_at = now()
         WHERE id = $1 AND tenant_id = $2 AND status = 'prepared' RETURNING *`,
        [id, c.tenantId, body.network, body.txSignature],
      );
      if (!r.rows[0]) throw fail(404, "NOT_FOUND", "Prepared anchor not found.");
      await appendEvent(client, c.tenantId, {
        eventType: "ANCHOR_RECORDED", actorId: c.userId, idempotencyKey: key, objectRef: String(r.rows[0].checkpoint_hash),
        meta: { anchorId: id, network: body.network, txSignature: body.txSignature, verified: false },
      });
      return r.rows[0];
    },
  );
  res.json(serializeAnchor(row));
}));

export default router;
