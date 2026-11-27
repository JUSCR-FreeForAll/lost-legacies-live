import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  ChainVerificationError,
  canonicalize,
  genesisBlock,
  nextBlock,
  verifyChain,
  verifyCheckpoint,
  type Block,
  type BlockMeta,
  type ChainManifest,
  type SignedCheckpoint,
} from "@workspace/fortress-core";
import type { PoolClient } from "pg";
import { fail } from "./errors";
import { getSigner, tenantManifest } from "./keys";
import { startupSucceeded } from "./startup";

type Queryable = Pick<PoolClient, "query">;

export interface AppendInput {
  eventType: string;
  actorId: string;
  objectRef?: string;
  idempotencyKey?: string | null;
  meta?: BlockMeta;
  /** Only for failure audits and recovery bookkeeping while RECOVERY_REQUIRED. */
  skipIntegrityGate?: boolean;
}

async function insertBlock(client: Queryable, tenantId: string, block: Block): Promise<void> {
  await client.query(
    `INSERT INTO fortress_events
      (tenant_id, idx, v, event_id, occurred_at_us, event_type, actor_id, object_ref,
       prev_hash, idempotency_key_hash, meta, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      tenantId, block.idx, block.v, block.event_id, block.occurred_at_us, block.event_type,
      block.actor_id, block.object_ref, block.prev_hash, block.idempotency_key_hash,
      JSON.stringify(block.meta), block.hash,
    ],
  );
  await client.query(
    "INSERT INTO fortress_outbox (tenant_id, idx, line) VALUES ($1,$2,$3)",
    [tenantId, block.idx, canonicalize(block)],
  );
}

/** Create a tenant with its deterministic genesis block. Returns the tenant id. */
export async function createTenant(client: Queryable, ownerUserId: string): Promise<string | null> {
  const id = randomUUID();
  const manifest = tenantManifest(id);
  const genesis = genesisBlock(manifest);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO fortress_tenants (id, owner_user_id, chain_manifest, head_idx, head_hash)
     VALUES ($1,$2,$3,0,$4) ON CONFLICT (owner_user_id) DO NOTHING RETURNING id`,
    [id, ownerUserId, JSON.stringify(manifest), genesis.hash],
  );
  if (!inserted.rows[0]) return null;
  await insertBlock(client, id, genesis);
  return id;
}

export async function openConditionCount(client: Queryable, tenantId: string | null): Promise<number> {
  const r = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM fortress_integrity_conditions
     WHERE resolved_at IS NULL AND (tenant_id IS NULL OR tenant_id = $1)`,
    [tenantId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Append one block atomically inside the caller's transaction. */
export async function appendEvent(
  client: Queryable,
  tenantId: string,
  input: AppendInput,
): Promise<Block> {
  const locked = await client.query<{ head_idx: number; head_hash: string }>(
    "SELECT head_idx, head_hash FROM fortress_tenants WHERE id = $1 FOR UPDATE",
    [tenantId],
  );
  const head = locked.rows[0];
  if (!head) throw fail(404, "NOT_FOUND", "Tenant not found.");
  if (!input.skipIntegrityGate && !startupSucceeded()) {
    throw fail(503, "NOT_READY", "Startup verification has not finished. Writes are paused until it succeeds.");
  }
  if (!input.skipIntegrityGate && (await openConditionCount(client, tenantId)) > 0) {
    throw fail(503, "RECOVERY_REQUIRED", "Integrity verification failed. Writes are paused until an administrator completes recovery.");
  }
  const block = nextBlock(
    { idx: Number(head.head_idx), hash: head.head_hash },
    {
      eventType: input.eventType,
      actorId: input.actorId,
      objectRef: input.objectRef,
      idempotencyKey: input.idempotencyKey ?? null,
      meta: input.meta ?? {},
    },
  );
  await insertBlock(client, tenantId, block);
  await client.query("UPDATE fortress_tenants SET head_idx = $2, head_hash = $3 WHERE id = $1", [
    tenantId, block.idx, block.hash,
  ]);
  return block;
}

export function rowToBlock(row: Record<string, unknown>): Block {
  return {
    v: Number(row.v),
    idx: Number(row.idx),
    event_id: String(row.event_id),
    occurred_at_us: Number(row.occurred_at_us),
    event_type: String(row.event_type),
    actor_id: String(row.actor_id),
    object_ref: String(row.object_ref),
    prev_hash: String(row.prev_hash),
    idempotency_key_hash: String(row.idempotency_key_hash),
    meta: row.meta as BlockMeta,
    hash: String(row.hash),
  };
}

export async function loadBlocks(client: Queryable, tenantId: string): Promise<Block[]> {
  const r = await client.query<Record<string, unknown>>(
    "SELECT * FROM fortress_events WHERE tenant_id = $1 ORDER BY idx",
    [tenantId],
  );
  return r.rows.map(rowToBlock);
}

export async function loadManifest(client: Queryable, tenantId: string): Promise<ChainManifest> {
  const r = await client.query<{ chain_manifest: ChainManifest }>(
    "SELECT chain_manifest FROM fortress_tenants WHERE id = $1",
    [tenantId],
  );
  if (!r.rows[0]) throw fail(404, "NOT_FOUND", "Tenant not found.");
  return r.rows[0].chain_manifest;
}

export function rowToSignedCheckpoint(row: Record<string, unknown>): SignedCheckpoint {
  return {
    checkpoint: row.body as SignedCheckpoint["checkpoint"],
    checkpoint_hash: String(row.checkpoint_hash),
    signature: String(row.signature),
  };
}

export async function trustedCheckpointSigners(client: Queryable, tenantId: string, manifest: ChainManifest): Promise<string[]> {
  const peers = await client.query<{ key_id: string }>(
    "SELECT key_id FROM fortress_trusted_signers WHERE tenant_id = $1 AND kind = 'peer' AND revoked_at IS NULL",
    [tenantId],
  );
  return [manifest.trust_key, ...peers.rows.map((r) => r.key_id)];
}

export interface LedgerVerification {
  height: number;
  tip: string;
  checkpointsChecked: number;
}

export class LedgerIntegrityError extends Error {
  constructor(readonly code: string, readonly detail: Record<string, unknown>) {
    super(code);
  }
}

/** Full fail-closed verification of one tenant chain plus every stored checkpoint. */
export async function verifyLedger(client: Queryable, tenantId: string): Promise<LedgerVerification> {
  const manifest = await loadManifest(client, tenantId);
  const blocks = await loadBlocks(client, tenantId);
  const cps = await client.query<Record<string, unknown>>(
    "SELECT * FROM fortress_checkpoints WHERE tenant_id = $1 ORDER BY height",
    [tenantId],
  );
  const signers = await trustedCheckpointSigners(client, tenantId, manifest);
  const signed = cps.rows.map(rowToSignedCheckpoint);
  for (const cp of signed) {
    const check = verifyCheckpoint(cp, signers);
    if (!check.ok) throw new LedgerIntegrityError(`CHECKPOINT_${check.code}`, { checkpointHash: cp.checkpoint_hash });
  }
  let report;
  try {
    report = verifyChain(manifest, blocks, signed.map((s) => s.checkpoint));
  } catch (err) {
    if (err instanceof ChainVerificationError) throw new LedgerIntegrityError(err.code, { idx: err.idx });
    throw new LedgerIntegrityError("MALFORMED_BLOCK", {});
  }
  const head = await client.query<{ head_idx: number; head_hash: string }>(
    "SELECT head_idx, head_hash FROM fortress_tenants WHERE id = $1",
    [tenantId],
  );
  const h = head.rows[0]!;
  if (Number(h.head_idx) !== report.height || h.head_hash !== report.tip) {
    throw new LedgerIntegrityError("HEAD_MISMATCH", { headIdx: Number(h.head_idx), chainHeight: report.height });
  }
  return { height: report.height, tip: report.tip, checkpointsChecked: signed.length };
}

/**
 * Record an integrity condition outside any failing transaction. Idempotent
 * per open (scope, code, detail.ref): distinct failing items or checkpoints
 * each keep their own condition so resolving one never hides another.
 */
export async function recordCondition(
  tenantId: string | null,
  code: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO fortress_integrity_conditions (tenant_id, code, detail)
     SELECT $1::uuid, $2, $3::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM fortress_integrity_conditions
       WHERE resolved_at IS NULL AND code = $2 AND tenant_id IS NOT DISTINCT FROM $1::uuid
         AND coalesce(detail->>'ref', '') = coalesce($3::jsonb->>'ref', ''))`,
    [tenantId, code, JSON.stringify(detail)],
  );
}

/**
 * Verify one tenant from a single consistent snapshot (REPEATABLE READ, read
 * only), so a concurrent append between reading blocks, checkpoints and the
 * head can never look like tampering.
 */
export async function verifyLedgerSnapshot(tenantId: string): Promise<LedgerVerification> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await verifyLedger(client, tenantId);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function currentTrustKey(): string {
  return getSigner().keyId;
}
