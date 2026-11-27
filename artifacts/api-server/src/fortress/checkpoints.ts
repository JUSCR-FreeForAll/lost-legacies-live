import { createCheckpoint, type SignedCheckpoint } from "@workspace/fortress-core";
import type { PoolClient } from "pg";
import { getSigner, installationName } from "./keys";
import { appendEvent, loadManifest } from "./ledger";

type Queryable = Pick<PoolClient, "query">;

/**
 * Sign the current tip. The checkpoint block itself is appended afterwards,
 * so the signed height always refers to an existing block.
 */
export async function createLocalCheckpoint(
  client: Queryable,
  tenantId: string,
  actorId: string,
  idempotencyKey: string | null,
): Promise<{ row: Record<string, unknown>; signed: SignedCheckpoint }> {
  const head = await client.query<{ head_idx: number; head_hash: string }>(
    "SELECT head_idx, head_hash FROM fortress_tenants WHERE id = $1 FOR UPDATE",
    [tenantId],
  );
  const manifest = await loadManifest(client, tenantId);
  const signer = getSigner();
  const signed = createCheckpoint(signer, {
    chainId: manifest.chain_id,
    height: Number(head.rows[0]!.head_idx),
    tipHash: head.rows[0]!.head_hash,
  });
  const inserted = await client.query<Record<string, unknown>>(
    `INSERT INTO fortress_checkpoints (tenant_id, height, tip_hash, checkpoint_hash, body, signature, signer, source, origin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'local',$8) RETURNING *`,
    [
      tenantId, signed.checkpoint.height, signed.checkpoint.tip_hash, signed.checkpoint_hash,
      JSON.stringify(signed.checkpoint), signed.signature, signer.keyId, installationName(),
    ],
  );
  await appendEvent(client, tenantId, {
    eventType: "CHECKPOINT_SIGNED",
    actorId,
    objectRef: signed.checkpoint_hash,
    idempotencyKey,
    meta: { height: signed.checkpoint.height, signer: signer.keyId },
  });
  return { row: inserted.rows[0]!, signed };
}

export async function serializeCheckpoint(client: Queryable, row: Record<string, unknown>) {
  const w = await client.query<{ witness_key: string; checkpoint_hash: string; signature: string }>(
    "SELECT witness_key, checkpoint_hash, signature FROM fortress_witnesses WHERE tenant_id = $1 AND checkpoint_hash = $2 ORDER BY created_at",
    [row.tenant_id, row.checkpoint_hash],
  );
  return {
    id: String(row.id),
    height: Number(row.height),
    tipHash: String(row.tip_hash),
    checkpointHash: String(row.checkpoint_hash),
    signer: String(row.signer),
    source: String(row.source) as "local" | "imported",
    origin: String(row.origin),
    createdAt: (row.created_at as Date).toISOString(),
    signed: {
      checkpoint: row.body as Record<string, unknown>,
      checkpoint_hash: String(row.checkpoint_hash),
      signature: String(row.signature),
    },
    witnesses: w.rows.map((x) => ({ witness: x.witness_key, checkpoint_hash: x.checkpoint_hash, signature: x.signature })),
  };
}
