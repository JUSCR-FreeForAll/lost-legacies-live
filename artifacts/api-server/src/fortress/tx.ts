import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { canonicalize, sha256Hex } from "@workspace/fortress-core";
import { ApiError, fail } from "./errors";
import { appendEvent } from "./ledger";
import { logger } from "../lib/logger";

export type Tx = PoolClient;

/**
 * Run fn in one Postgres transaction. On failure the transaction rolls back
 * completely; if the error carries a failure audit, that audit block is then
 * committed in its own transaction so failed attempts are never lost with the
 * rollback.
 */
export async function withTransaction<T>(fn: (client: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof ApiError && err.audit) await commitFailureAudit(err);
    throw err;
  } finally {
    client.release();
  }
}

export async function commitFailureAudit(err: ApiError): Promise<void> {
  const audit = err.audit;
  if (!audit) return;
  err.audit = null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await appendEvent(client, audit.tenantId, {
      eventType: audit.eventType,
      actorId: audit.actorId,
      meta: { ...audit.meta, code: err.code },
      skipIntegrityGate: true,
    });
    await client.query("COMMIT");
  } catch (auditErr) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error({ code: err.code, auditError: (auditErr as Error).message }, "Failure audit could not be committed");
  } finally {
    client.release();
  }
}

export interface IdempotentOptions {
  tenantId: string;
  actorId: string;
  route: string;
  idempotencyKey: unknown;
  /** Request fields that define "the same request". Never include secrets in plaintext. */
  fingerprint: Record<string, unknown>;
}

/**
 * Atomic idempotent commit: the tenant row is locked, a prior result for the
 * key is replayed (same actor and same request only), otherwise the callback,
 * its ledger blocks, outbox rows and the saved response commit together.
 */
export async function runIdempotent<T>(
  opts: IdempotentOptions,
  callback: (client: Tx, idempotencyKey: string) => Promise<T>,
  replay?: (saved: T) => T,
): Promise<T> {
  const key = opts.idempotencyKey;
  if (typeof key !== "string" || key.length < 8 || key.length > 100) {
    throw fail(400, "BAD_REQUEST", "A valid idempotencyKey (8-100 characters) is required.");
  }
  const requestHash = sha256Hex(`${opts.route}\u0000${canonicalize(opts.fingerprint)}`);
  return withTransaction(async (client) => {
    await client.query("SELECT id FROM fortress_tenants WHERE id = $1 FOR UPDATE", [opts.tenantId]);
    const previous = await client.query<{ actor: string; request_hash: string; response: T }>(
      "SELECT actor, request_hash, response FROM fortress_operations WHERE tenant_id = $1 AND idempotency_key = $2",
      [opts.tenantId, key],
    );
    const saved = previous.rows[0];
    if (saved) {
      if (saved.actor !== opts.actorId || saved.request_hash !== requestHash) {
        throw fail(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different operation.");
      }
      return replay ? replay(saved.response) : saved.response;
    }
    const result = await callback(client, key);
    await client.query(
      `INSERT INTO fortress_operations (tenant_id, idempotency_key, actor, request_hash, response)
       VALUES ($1,$2,$3,$4,$5)`,
      [opts.tenantId, key, opts.actorId, requestHash, JSON.stringify(stripSecrets(result))],
    );
    return result;
  });
}

/** Saved idempotent responses never retain one-time secrets. */
function stripSecrets<T>(value: T): unknown {
  if (!value || typeof value !== "object") return value;
  const SECRET_FIELDS = new Set(["token", "recoveryKey", "newCodes", "codes"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELDS.has(k)) out[k] = Array.isArray(v) ? [] : null;
    else out[k] = v;
  }
  return out;
}
