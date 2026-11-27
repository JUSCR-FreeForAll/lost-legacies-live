import { isMessageId, type MessageId } from "@workspace/fortress-core";
import type { PoolClient } from "pg";
import { fail } from "./errors";

type Queryable = Pick<PoolClient, "query">;

export const CONSENT_PURPOSES = {
  evidence_storage: "Store encrypted evidence items you upload. Nothing is stored without this.",
  recovery_contacts: "Let people you choose help you recover access. They see only a request to approve.",
  witness_sharing: "Share signed checkpoints (hashes only) with peer installations you trust.",
  jsonld_import: "Accept linked-data (JSON-LD) records into your ledger.",
  seamcraft_import: "Accept signed Seamcraft envelopes from senders you registered.",
  juscr_ingest: "Allow JUSCR (or another system) to push backups with a write-only ingest credential.",
  external_anchor: "Prepare hash-only commitments that you may publish on Solana. No personal data leaves.",
} as const;

export type ConsentPurpose = keyof typeof CONSENT_PURPOSES;

export function isConsentPurpose(value: string): value is ConsentPurpose {
  return Object.prototype.hasOwnProperty.call(CONSENT_PURPOSES, value);
}

export async function grantedPurposes(client: Queryable, tenantId: string): Promise<Set<string>> {
  const r = await client.query<{ purpose: string }>(
    "SELECT purpose FROM fortress_consents WHERE tenant_id = $1 AND state = 'granted'",
    [tenantId],
  );
  return new Set(r.rows.map((x) => x.purpose));
}

export async function requireConsent(client: Queryable, tenantId: string, purpose: ConsentPurpose): Promise<void> {
  const granted = await grantedPurposes(client, tenantId);
  if (!granted.has(purpose)) {
    throw fail(403, "CONSENT_REQUIRED", `This action needs the "${purpose}" consent. Grant it in Protection settings first.`);
  }
}

/**
 * In-app notification policy:
 *  - in-app only (no email, SMS or push is ever sent by this service);
 *  - only message IDs and variables are stored, never free text;
 *  - when the tenant chose "suppressed" or Safe Recovery mode is on, the
 *    notification is stored as suppressed and not shown in the inbox;
 *  - contacts are never notified when removed.
 */
export async function notify(
  client: Queryable,
  tenantId: string,
  recipientUserId: string,
  messageId: MessageId,
  vars: Record<string, string | number> = {},
): Promise<void> {
  if (!isMessageId(messageId)) throw new Error("UNKNOWN_MESSAGE_ID");
  const t = await client.query<{ safe_mode: boolean; notification_mode: string; owner_user_id: string }>(
    "SELECT safe_mode, notification_mode, owner_user_id FROM fortress_tenants WHERE id = $1",
    [tenantId],
  );
  const row = t.rows[0];
  const ownerInbox = row?.owner_user_id === recipientUserId;
  const suppressed = ownerInbox && (row?.safe_mode === true || row?.notification_mode === "suppressed");
  await client.query(
    `INSERT INTO fortress_notifications (tenant_id, recipient_user_id, message_id, vars, suppressed)
     VALUES ($1,$2,$3,$4,$5)`,
    [tenantId, recipientUserId, messageId, JSON.stringify(vars), suppressed],
  );
}
