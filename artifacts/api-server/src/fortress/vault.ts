import { randomBytes } from "node:crypto";
import {
  decryptAesGcm,
  encryptAesGcm,
  openBytes,
  sealBytes,
  sha256Hex,
  type CiphertextEnvelope,
  type SealedObject,
} from "@workspace/fortress-core";
import type { PoolClient } from "pg";
import { ApiError, fail } from "./errors";
import { getKek } from "./keys";

type Queryable = Pick<PoolClient, "query">;

export const MAX_BACKUP_BYTES = 256 * 1024;

export const backupContext = (tenant: string, id: string) => `tenant:${tenant}:backup:${id}`;
export const stageContext = (tenant: string, id: string) => `tenant:${tenant}:stage:${id}`;
export const evidenceContext = (tenant: string, id: string) => `tenant:${tenant}:evidence:${id}`;

const recoveryKeyAad = (tenant: string) => `phoenix-fortress:master:${tenant}:v1`;

export function generateRecoveryKey(): Buffer {
  return randomBytes(32);
}

export function recoveryKeyFingerprint(key: Buffer): string {
  return sha256Hex(key).slice(0, 16);
}

export function sealRecoveryKey(key: Buffer, tenant: string): CiphertextEnvelope {
  return encryptAesGcm(key, getKek(), recoveryKeyAad(tenant));
}

export function openRecoveryKey(envelope: CiphertextEnvelope, tenant: string): Buffer {
  try {
    return decryptAesGcm(envelope, getKek(), recoveryKeyAad(tenant));
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw fail(503, "ENCRYPTION_KEY_INVALID", "The stored recovery-key envelope could not be opened. Data remains unchanged.");
  }
}

export function decodePresentedKey(value: string): Buffer {
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32) throw fail(400, "BAD_REQUEST", "Recovery key must be the 44-character base64 value shown at setup.");
  return key;
}

export async function getRecoveryKey(client: Queryable, tenant: string): Promise<Buffer> {
  const r = await client.query<{ key_status: string; key_envelope: CiphertextEnvelope | null }>(
    "SELECT key_status, key_envelope FROM fortress_tenants WHERE id = $1",
    [tenant],
  );
  const row = r.rows[0];
  if (!row || row.key_status !== "active" || !row.key_envelope) {
    throw fail(409, "RECOVERY_KEY_NOT_ACTIVE", "Complete recovery-key setup before storing or restoring data.");
  }
  return openRecoveryKey(row.key_envelope, tenant);
}

export function sealedColumns(sealed: SealedObject): unknown[] {
  return [
    sealed.checksum,
    sealed.ciphertext.ciphertext, sealed.ciphertext.nonce, sealed.ciphertext.tag,
    sealed.wrappedDataKey.ciphertext, sealed.wrappedDataKey.nonce, sealed.wrappedDataKey.tag,
  ];
}

function env(c: unknown, n: unknown, t: unknown): CiphertextEnvelope {
  if (!c || !n || !t) throw fail(409, "INTEGRITY_FAILURE", "Encrypted payload is unavailable.");
  return { ciphertext: String(c), nonce: String(n), tag: String(t) };
}

export function rowCiphertext(row: Record<string, unknown>): { ciphertext: CiphertextEnvelope; wrapped: CiphertextEnvelope } {
  return {
    ciphertext: env(row.ciphertext, row.nonce, row.tag),
    wrapped: env(row.wrapped_data_key, row.data_key_nonce, row.data_key_tag),
  };
}

export function openRow(row: Record<string, unknown>, key: Buffer, context: string): Buffer {
  const { ciphertext, wrapped } = rowCiphertext(row);
  try {
    return openBytes(ciphertext, wrapped, key, context, String(row.checksum));
  } catch {
    throw fail(409, "INTEGRITY_FAILURE", "Stored ciphertext failed authentication or checksum verification.");
  }
}

export function seal(plaintext: Buffer, key: Buffer, context: string): SealedObject {
  return sealBytes(plaintext, key, context);
}

/** Rewrap every retained data key from one recovery key to another (no payload re-encryption). */
export async function rewrapAll(client: Queryable, tenant: string, from: Buffer, to: Buffer): Promise<Record<string, number>> {
  const tables: Array<[string, string, (t: string, id: string) => string]> = [
    ["fortress_backups", "payload_status = 'retained'", backupContext],
    ["fortress_stages", "status = 'staged'", stageContext],
    ["fortress_evidence", "status = 'retained'", evidenceContext],
  ];
  const counts: Record<string, number> = {};
  for (const [table, where, context] of tables) {
    const rows = await client.query<Record<string, unknown>>(
      `SELECT id, wrapped_data_key, data_key_nonce, data_key_tag FROM ${table} WHERE tenant_id = $1 AND ${where} FOR UPDATE`,
      [tenant],
    );
    for (const row of rows.rows) {
      const aad = `${context(tenant, String(row.id))}:data-key:v1`;
      const dek = decryptAesGcm(env(row.wrapped_data_key, row.data_key_nonce, row.data_key_tag), from, aad);
      const wrapped = encryptAesGcm(dek, to, aad);
      dek.fill(0);
      await client.query(
        `UPDATE ${table} SET wrapped_data_key = $2, data_key_nonce = $3, data_key_tag = $4 WHERE id = $1`,
        [row.id, wrapped.ciphertext, wrapped.nonce, wrapped.tag],
      );
    }
    counts[table.replace("fortress_", "")] = rows.rows.length;
  }
  return counts;
}
