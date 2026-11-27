import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = (name = "created_at") =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const tenantRef = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => fortressTenants.id, { onDelete: "cascade" });

/** One row: the installation's trust anchor. A mismatch forces RECOVERY_REQUIRED. */
export const fortressInstallation = pgTable("fortress_installation", {
  id: text("id").primaryKey(),
  installationName: text("installation_name").notNull(),
  trustKey: text("trust_key").notNull(),
  createdAt: createdAt(),
});

export const fortressTenants = pgTable(
  "fortress_tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id").notNull(),
    createdAt: createdAt(),
    keyStatus: text("key_status").notNull().default("unconfigured"),
    keyFingerprint: text("key_fingerprint"),
    keyEnvelope: jsonb("key_envelope").$type<Record<string, string> | null>(),
    pendingFingerprint: text("pending_fingerprint"),
    pendingEnvelope: jsonb("pending_envelope").$type<Record<string, string> | null>(),
    pendingMode: text("pending_mode"),
    pendingExpiresAt: ts("pending_expires_at"),
    chainManifest: jsonb("chain_manifest").$type<Record<string, unknown>>().notNull(),
    headIdx: integer("head_idx").notNull().default(0),
    headHash: text("head_hash").notNull(),
    safeMode: boolean("safe_mode").notNull().default(false),
    locale: text("locale").notNull().default("en"),
    notificationMode: text("notification_mode").notNull().default("in_app"),
    recoveryThreshold: integer("recovery_threshold").notNull().default(2),
    recoveryDelayHours: integer("recovery_delay_hours").notNull().default(72),
  },
  (table) => [uniqueIndex("fortress_tenants_owner_uidx").on(table.ownerUserId)],
);

export const fortressMembers = pgTable(
  "fortress_members",
  {
    tenantId: tenantRef(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.userId] })],
);

export const fortressDatasets = pgTable(
  "fortress_datasets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    name: text("name").notNull(),
    source: text("source").notNull(),
    retentionDays: integer("retention_days").notNull(),
    intervalMinutes: integer("interval_minutes").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("fortress_datasets_tenant_source_uidx").on(table.tenantId, table.source),
    index("fortress_datasets_tenant_idx").on(table.tenantId),
  ],
);

const sealedColumns = () => ({
  checksum: text("checksum").notNull(),
  ciphertext: text("ciphertext"),
  nonce: text("nonce"),
  tag: text("tag"),
  wrappedDataKey: text("wrapped_data_key"),
  dataKeyNonce: text("data_key_nonce"),
  dataKeyTag: text("data_key_tag"),
});

export const fortressBackups = pgTable(
  "fortress_backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => fortressDatasets.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    manifestVersion: integer("manifest_version").notNull().default(1),
    ...sealedColumns(),
    bytes: integer("bytes").notNull(),
    source: text("source").notNull().default("session"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    payloadStatus: text("payload_status").notNull().default("retained"),
  },
  (table) => [
    uniqueIndex("fortress_backups_tenant_dataset_version_uidx").on(table.tenantId, table.datasetId, table.version),
    index("fortress_backups_tenant_created_idx").on(table.tenantId, table.createdAt),
  ],
);

export const fortressStages = pgTable(
  "fortress_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    backupId: uuid("backup_id")
      .notNull()
      .references(() => fortressBackups.id, { onDelete: "restrict" }),
    target: text("target").notNull(),
    ...sealedColumns(),
    createdAt: createdAt(),
    status: text("status").notNull().default("staged"),
  },
  (table) => [index("fortress_stages_tenant_idx").on(table.tenantId, table.createdAt)],
);

/** Versioned hash-chain blocks. Field names mirror the canonical block exactly. */
export const fortressEvents = pgTable(
  "fortress_events",
  {
    tenantId: tenantRef(),
    idx: integer("idx").notNull(),
    v: integer("v").notNull(),
    eventId: text("event_id").notNull(),
    occurredAtUs: bigint("occurred_at_us", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    actorId: text("actor_id").notNull(),
    objectRef: text("object_ref").notNull(),
    prevHash: text("prev_hash").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull(),
    hash: text("hash").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.idx] }),
    uniqueIndex("fortress_events_event_id_uidx").on(table.eventId),
  ],
);

/** Transactional outbox: written in the same transaction as the block it mirrors. */
export const fortressOutbox = pgTable(
  "fortress_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: tenantRef(),
    idx: integer("idx").notNull(),
    line: text("line").notNull(),
    createdAt: createdAt(),
    exportedAt: ts("exported_at"),
  },
  (table) => [
    uniqueIndex("fortress_outbox_tenant_idx_uidx").on(table.tenantId, table.idx),
    index("fortress_outbox_pending_idx").on(table.exportedAt),
  ],
);

export const fortressCheckpoints = pgTable(
  "fortress_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    height: integer("height").notNull(),
    tipHash: text("tip_hash").notNull(),
    checkpointHash: text("checkpoint_hash").notNull(),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    signature: text("signature").notNull(),
    signer: text("signer").notNull(),
    source: text("source").notNull(),
    origin: text("origin").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("fortress_checkpoints_hash_uidx").on(table.tenantId, table.checkpointHash),
    index("fortress_checkpoints_tenant_height_idx").on(table.tenantId, table.height),
  ],
);

export const fortressWitnesses = pgTable(
  "fortress_witnesses",
  {
    tenantId: tenantRef(),
    checkpointHash: text("checkpoint_hash").notNull(),
    witnessKey: text("witness_key").notNull(),
    signature: text("signature").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.checkpointHash, table.witnessKey] })],
);

export const fortressTrustedSigners = pgTable(
  "fortress_trusted_signers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    keyId: text("key_id").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    createdAt: createdAt(),
    revokedAt: ts("revoked_at"),
  },
  (table) => [uniqueIndex("fortress_signers_uidx").on(table.tenantId, table.kind, table.keyId)],
);

export const fortressIntegrityConditions = pgTable(
  "fortress_integrity_conditions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => fortressTenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    detectedAt: createdAt("detected_at"),
    resolvedAt: ts("resolved_at"),
    resolvedBy: text("resolved_by"),
  },
  (table) => [index("fortress_conditions_open_idx").on(table.tenantId, table.resolvedAt)],
);

export const fortressRecoveryCodes = pgTable(
  "fortress_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    userId: text("user_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    codeHash: text("code_hash").notNull(),
    createdAt: createdAt(),
    usedAt: ts("used_at"),
    voidedAt: ts("voided_at"),
  },
  (table) => [uniqueIndex("fortress_recovery_codes_hash_uidx").on(table.codeHash)],
);

/** Durable, cross-instance throttle windows. */
export const fortressThrottle = pgTable("fortress_throttle", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowUntil: ts("window_until").notNull(),
});

export const fortressUserSecurity = pgTable("fortress_user_security", {
  userId: text("user_id").primaryKey(),
  sessionsNotBefore: ts("sessions_not_before").notNull(),
  exemptSessionId: text("exempt_session_id"),
  /** Provider session listing failed after a security action; retried in the background. */
  providerSyncPending: boolean("provider_sync_pending").notNull().default(false),
  updatedAt: createdAt("updated_at"),
});

/**
 * Sessions ended by a security action. Enforced locally on every request
 * whether or not the identity provider accepted the revocation.
 */
export const fortressRevokedSessions = pgTable("fortress_revoked_sessions", {
  sessionId: text("session_id").primaryKey(),
  userId: text("user_id").notNull(),
  revokedAt: createdAt("revoked_at"),
  providerRevoked: boolean("provider_revoked").notNull().default(false),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

export const fortressCredentials = pgTable(
  "fortress_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => fortressDatasets.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    useCount: integer("use_count").notNull().default(0),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("fortress_credentials_hash_uidx").on(table.tokenHash),
    index("fortress_credentials_tenant_idx").on(table.tenantId),
  ],
);

export const fortressOperations = pgTable(
  "fortress_operations",
  {
    tenantId: tenantRef(),
    idempotencyKey: text("idempotency_key").notNull(),
    actor: text("actor").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.idempotencyKey] })],
);

export const fortressRestorePlans = pgTable(
  "fortress_restore_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    actor: text("actor").notNull(),
    backupId: uuid("backup_id")
      .notNull()
      .references(() => fortressBackups.id, { onDelete: "restrict" }),
    target: text("target").notNull(),
    confirmationHash: text("confirmation_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (table) => [index("fortress_plans_tenant_idx").on(table.tenantId)],
);

export const fortressContacts = pgTable(
  "fortress_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    contactUserId: text("contact_user_id").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    removedAt: ts("removed_at"),
  },
  (table) => [index("fortress_contacts_tenant_idx").on(table.tenantId)],
);

export const fortressCeremonies = pgTable(
  "fortress_ceremonies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    initiatedBy: text("initiated_by").notNull(),
    status: text("status").notNull().default("pending"),
    threshold: integer("threshold").notNull(),
    readyAt: ts("ready_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
  },
  (table) => [index("fortress_ceremonies_tenant_idx").on(table.tenantId)],
);

export const fortressApprovals = pgTable(
  "fortress_approvals",
  {
    ceremonyId: uuid("ceremony_id")
      .notNull()
      .references(() => fortressCeremonies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => fortressContacts.id, { onDelete: "cascade" }),
    approvedAt: createdAt("approved_at"),
  },
  (table) => [primaryKey({ columns: [table.ceremonyId, table.contactId] })],
);

export const fortressConsents = pgTable(
  "fortress_consents",
  {
    tenantId: tenantRef(),
    purpose: text("purpose").notNull(),
    state: text("state").notNull(),
    version: integer("version").notNull().default(1),
    updatedBy: text("updated_by").notNull(),
    updatedAt: createdAt("updated_at"),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.purpose] })],
);

export const fortressEvidence = pgTable(
  "fortress_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    label: text("label").notNull(),
    ...sealedColumns(),
    bytes: integer("bytes").notNull(),
    status: text("status").notNull().default("retained"),
    createdAt: createdAt(),
  },
  (table) => [index("fortress_evidence_tenant_idx").on(table.tenantId)],
);

export const fortressNotifications = pgTable(
  "fortress_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    recipientUserId: text("recipient_user_id").notNull(),
    messageId: text("message_id").notNull(),
    vars: jsonb("vars").$type<Record<string, string | number>>().notNull(),
    suppressed: boolean("suppressed").notNull().default(false),
    createdAt: createdAt(),
    readAt: ts("read_at"),
  },
  (table) => [index("fortress_notifications_recipient_idx").on(table.recipientUserId, table.createdAt)],
);

export const fortressRevocationTombstones = pgTable(
  "fortress_revocation_tombstones",
  {
    tenantId: tenantRef(),
    kind: text("kind").notNull(),
    itemId: text("item_id").notNull(),
    revokedAtUs: bigint("revoked_at_us", { mode: "number" }).notNull(),
    origin: text("origin").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.kind, table.itemId] })],
);

export const fortressInteropRecords = pgTable(
  "fortress_interop_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    adapter: text("adapter").notNull(),
    objectRef: text("object_ref").notNull(),
    canonical: text("canonical").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull(),
    eventIdx: integer("event_idx").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("fortress_interop_uidx").on(table.tenantId, table.adapter, table.objectRef)],
);

export const fortressSeamcraftNonces = pgTable(
  "fortress_seamcraft_nonces",
  {
    tenantId: tenantRef(),
    sender: text("sender").notNull(),
    nonce: text("nonce").notNull(),
    seenAt: createdAt("seen_at"),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.sender, table.nonce] })],
);

export const fortressAnchors = pgTable(
  "fortress_anchors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    checkpointHash: text("checkpoint_hash").notNull(),
    commitment: jsonb("commitment").$type<Record<string, unknown>>().notNull(),
    memo: text("memo").notNull(),
    status: text("status").notNull().default("prepared"),
    network: text("network"),
    txSignature: text("tx_signature"),
    createdAt: createdAt(),
    recordedAt: ts("recorded_at"),
  },
  (table) => [index("fortress_anchors_tenant_idx").on(table.tenantId)],
);
