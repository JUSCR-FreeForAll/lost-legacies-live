import { randomUUID } from "node:crypto";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  type CiphertextEnvelope,
} from "@workspace/fortress-core";
import type { PoolClient } from "pg";
import { appendEvent } from "./ledger";
import { recoveryCodePepper } from "./keys";
import { notify } from "./protection";
import {
  generateRecoveryKey,
  openRecoveryKey,
  recoveryKeyFingerprint,
  sealRecoveryKey,
} from "./vault";

type Queryable = Pick<PoolClient, "query">;

export const codeScope = (tenantId: string, userId: string) => `${tenantId}:${userId}`;

export function codeHash(tenantId: string, userId: string, code: string): string | null {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return null;
  return hashRecoveryCode(recoveryCodePepper(), normalized, codeScope(tenantId, userId));
}

/** Void every unused code for the user and store a new batch (HMAC only). */
export async function issueRecoveryCodes(
  client: Queryable,
  tenantId: string,
  userId: string,
): Promise<{ codes: string[]; batchId: string; createdAt: string }> {
  await client.query(
    "UPDATE fortress_recovery_codes SET voided_at = now() WHERE tenant_id = $1 AND user_id = $2 AND used_at IS NULL AND voided_at IS NULL",
    [tenantId, userId],
  );
  const codes = generateRecoveryCodes();
  const batchId = randomUUID();
  for (const code of codes) {
    await client.query(
      "INSERT INTO fortress_recovery_codes (tenant_id, user_id, batch_id, code_hash) VALUES ($1,$2,$3,$4)",
      [tenantId, userId, batchId, codeHash(tenantId, userId, code)],
    );
  }
  return { codes, batchId, createdAt: new Date().toISOString() };
}

export async function addTombstone(
  client: Queryable,
  tenantId: string,
  kind: "credential" | "recovery_contact" | "consent" | "trusted_signer",
  itemId: string,
  origin: string,
): Promise<void> {
  await client.query(
    `INSERT INTO fortress_revocation_tombstones (tenant_id, kind, item_id, revoked_at_us, origin)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [tenantId, kind, itemId, Date.now() * 1000, origin],
  );
}

export async function revokeAllCredentials(client: Queryable, tenantId: string, origin: string): Promise<number> {
  const r = await client.query<{ id: string }>(
    "UPDATE fortress_credentials SET revoked = true WHERE tenant_id = $1 AND revoked = false RETURNING id",
    [tenantId],
  );
  for (const row of r.rows) await addTombstone(client, tenantId, "credential", row.id, origin);
  return r.rows.length;
}

export async function markSessionsRevoked(client: Queryable, userId: string, keepSessionId: string | null): Promise<void> {
  await client.query(
    `INSERT INTO fortress_user_security (user_id, sessions_not_before, exempt_session_id, updated_at)
     VALUES ($1, now(), $2, now())
     ON CONFLICT (user_id) DO UPDATE SET sessions_not_before = now(), exempt_session_id = $2, updated_at = now()`,
    [userId, keepSessionId],
  );
}

export interface EmergencyOutcome {
  method: "recovery_code" | "contact_ceremony";
  sessionsRevoked: boolean;
  credentialsRevoked: number;
  recoveryKey: string | null;
  fingerprint: string | null;
  expiresAt: string | null;
  newCodes: string[];
}

/**
 * Account-takeover reset shared by recovery codes and contact ceremonies:
 * end other sessions, revoke every API credential, issue a replacement
 * recovery key (pending confirmation via rotate/confirm) and a new code set.
 * The old recovery key is opened server-side with the KEK so encrypted data
 * stays recoverable even when the owner lost their copy.
 */
export async function emergencyReset(
  client: Queryable,
  tenantId: string,
  userId: string,
  sessionId: string | null,
  method: EmergencyOutcome["method"],
  origin: string,
): Promise<EmergencyOutcome> {
  await markSessionsRevoked(client, userId, sessionId);
  const credentialsRevoked = await revokeAllCredentials(client, tenantId, origin);
  const t = await client.query<{ key_status: string; key_envelope: CiphertextEnvelope | null; key_fingerprint: string | null }>(
    "SELECT key_status, key_envelope, key_fingerprint FROM fortress_tenants WHERE id = $1 FOR UPDATE",
    [tenantId],
  );
  let recoveryKey: string | null = null;
  let fingerprint: string | null = null;
  let expiresAt: string | null = null;
  const row = t.rows[0];
  if (row?.key_status === "active" && row.key_envelope) {
    openRecoveryKey(row.key_envelope, tenantId).fill(0); // proves the KEK can still open it
    const next = generateRecoveryKey();
    fingerprint = recoveryKeyFingerprint(next);
    const expires = new Date(Date.now() + 60 * 60_000);
    expiresAt = expires.toISOString();
    await client.query(
      `UPDATE fortress_tenants SET pending_fingerprint = $2, pending_envelope = $3,
         pending_mode = 'rotation', pending_expires_at = $4 WHERE id = $1`,
      [tenantId, fingerprint, JSON.stringify(sealRecoveryKey(next, tenantId)), expires],
    );
    recoveryKey = next.toString("base64");
    next.fill(0);
  }
  const issued = await issueRecoveryCodes(client, tenantId, userId);
  await appendEvent(client, tenantId, {
    eventType: "EMERGENCY_RECOVERY_COMPLETED",
    actorId: userId,
    meta: {
      method,
      credentialsRevoked,
      sessionsRevoked: true,
      replacementKeyFingerprint: fingerprint,
      newCodeBatch: issued.batchId,
    },
    skipIntegrityGate: true,
  });
  await notify(client, tenantId, userId, "recovery.sessions.revoked", { count: 1 });
  await notify(client, tenantId, userId, "recovery.credentials.revoked", { count: credentialsRevoked });
  await notify(client, tenantId, userId, "recovery.codes.regenerated", { count: issued.codes.length });
  return {
    method,
    sessionsRevoked: true,
    credentialsRevoked,
    recoveryKey,
    fingerprint,
    expiresAt,
    newCodes: issued.codes,
  };
}
