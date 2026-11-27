import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  ApplyRetentionBody,
  ConfirmRestoreBody,
  CreateBackupBody,
  PlanRestoreBody,
  RegisterDatasetBody,
  RollbackStageBody,
  SetMemberBody,
  UpdatePolicyBody,
  ResolveIntegrityBody,
} from "@workspace/api-zod";
import { canonicalize, sha256Hex, digestsEqual, verifyCheckpoint, type SignedCheckpoint } from "@workspace/fortress-core";
import { fail } from "../../fortress/errors";
import { ctx, handler, iso, isoReq, parseBody, parseId } from "../../fortress/http";
import { requireAdmin } from "../../fortress/auth";
import { appendEvent, openConditionCount } from "../../fortress/ledger";
import { runIdempotent, withTransaction } from "../../fortress/tx";
import {
  LedgerIntegrityError,
  loadManifest,
  recordCondition,
  trustedCheckpointSigners,
  verifyLedgerSnapshot,
} from "../../fortress/ledger";
import { currentTrustKey } from "../../fortress/ledger";
import {
  MAX_BACKUP_BYTES,
  backupContext,
  getRecoveryKey,
  openRow,
  seal,
  sealedColumns,
  stageContext,
  evidenceContext,
} from "../../fortress/vault";
import { USER_GUIDE } from "../../fortress/guide";

const router: IRouter = Router();

export function serializeBackup(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    datasetId: String(row.dataset_id),
    datasetName: String(row.dataset_name ?? ""),
    version: Number(row.version),
    manifestVersion: Number(row.manifest_version),
    checksum: String(row.checksum),
    bytes: Number(row.bytes),
    createdAt: isoReq(row.created_at as Date),
    expiresAt: isoReq(row.expires_at as Date),
    status: String(row.payload_status) as "retained" | "expired" | "purged",
    source: String(row.source) as "session" | "ingest",
  };
}

function serializeStage(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    backupId: String(row.backup_id),
    target: String(row.target),
    checksum: String(row.checksum),
    createdAt: isoReq(row.created_at as Date),
    status: String(row.status) as "staged" | "rolled_back",
  };
}

function serializeDataset(row: Record<string, unknown>) {
  const interval = Number(row.interval_minutes);
  const last = row.last_backup_at ? new Date(row.last_backup_at as Date) : null;
  const base = last ?? new Date(row.created_at as Date);
  return {
    id: String(row.id),
    name: String(row.name),
    source: String(row.source),
    retentionDays: Number(row.retention_days),
    intervalMinutes: interval,
    createdAt: isoReq(row.created_at as Date),
    version: Number(row.version ?? 0),
    nextDueAt: interval > 0 ? new Date(base.getTime() + interval * 60_000).toISOString() : null,
  };
}

const DATASET_SQL = `SELECT d.*, COALESCE(max(b.version), 0) AS version, max(b.created_at) AS last_backup_at
  FROM fortress_datasets d LEFT JOIN fortress_backups b ON b.dataset_id = d.id
  WHERE d.tenant_id = $1`;

/** Store one backup (shared by session backups and ingest credentials). */
export async function storeBackup(
  client: Parameters<Parameters<typeof withTransaction>[0]>[0],
  tenantId: string,
  actorId: string,
  datasetId: string,
  data: unknown,
  source: "session" | "ingest",
  idempotencyKey: string,
) {
  const ds = await client.query<{ id: string; name: string; retention_days: number }>(
    "SELECT id, name, retention_days FROM fortress_datasets WHERE id = $1 AND tenant_id = $2",
    [datasetId, tenantId],
  );
  const dataset = ds.rows[0];
  if (!dataset) throw fail(404, "NOT_FOUND", "Dataset not found.");
  let plaintext: Buffer;
  try {
    plaintext = Buffer.from(canonicalize(data), "utf8");
  } catch {
    throw fail(400, "BAD_REQUEST", "Backup data must be plain JSON (finite numbers, no undefined).");
  }
  if (plaintext.byteLength > MAX_BACKUP_BYTES) throw fail(413, "PAYLOAD_TOO_LARGE", "Backup exceeds 256 KiB.");
  const key = await getRecoveryKey(client, tenantId);
  const id = randomUUID();
  const sealed = seal(plaintext, key, backupContext(tenantId, id));
  key.fill(0);
  const v = await client.query<{ v: number }>(
    "SELECT COALESCE(max(version), 0) + 1 AS v FROM fortress_backups WHERE dataset_id = $1",
    [datasetId],
  );
  const version = Number(v.rows[0]!.v);
  const expiresAt = new Date(Date.now() + Number(dataset.retention_days) * 86_400_000);
  const inserted = await client.query<Record<string, unknown>>(
    `INSERT INTO fortress_backups (id, tenant_id, dataset_id, version, checksum, ciphertext, nonce, tag,
       wrapped_data_key, data_key_nonce, data_key_tag, bytes, source, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [id, tenantId, datasetId, version, ...sealedColumns(sealed), sealed.bytes, source, expiresAt],
  );
  await appendEvent(client, tenantId, {
    eventType: "BACKUP_CREATED",
    actorId,
    objectRef: `sha256:${sealed.checksum}`,
    idempotencyKey,
    meta: { backupId: id, datasetId, version, bytes: sealed.bytes, source },
  });
  return { ...inserted.rows[0]!, dataset_name: dataset.name };
}

router.get("/v1/guide", (_req, res) => {
  res.json({ markdown: USER_GUIDE });
});

router.get("/v1/me", handler(async (_req, res) => {
  const c = ctx(res);
  const t = await pool.query<{ safe_mode: boolean; locale: string; notification_mode: string }>(
    "SELECT safe_mode, locale, notification_mode FROM fortress_tenants WHERE id = $1",
    [c.tenantId],
  );
  const row = t.rows[0]!;
  res.json({
    userId: c.userId,
    tenantId: c.tenantId,
    role: c.role,
    tenants: res.locals.tenants as string[],
    safeMode: row.safe_mode,
    locale: row.locale,
    notificationMode: row.notification_mode,
    recoveryRequired: (await openConditionCount(pool, c.tenantId)) > 0,
  });
}));

router.get("/v1/overview", handler(async (_req, res) => {
  const c = ctx(res);
  const r = await pool.query<Record<string, string | Date | null>>(
    `SELECT
       (SELECT count(*) FROM fortress_datasets WHERE tenant_id = $1) AS datasets,
       (SELECT count(*) FROM fortress_backups WHERE tenant_id = $1 AND payload_status = 'retained') AS backups,
       (SELECT COALESCE(sum(bytes),0) FROM fortress_backups WHERE tenant_id = $1 AND payload_status = 'retained') AS retained_bytes,
       (SELECT count(*) FROM fortress_stages WHERE tenant_id = $1 AND status = 'staged') AS staged,
       (SELECT head_idx FROM fortress_tenants WHERE id = $1) AS height,
       (SELECT max(created_at) FROM fortress_backups WHERE tenant_id = $1) AS last_backup,
       (SELECT count(*) FROM fortress_notifications WHERE tenant_id = $1 AND recipient_user_id = $2 AND read_at IS NULL AND suppressed = false) AS unread`,
    [c.tenantId, c.userId],
  );
  const row = r.rows[0]!;
  const ds = await pool.query<Record<string, unknown>>(`${DATASET_SQL} GROUP BY d.id`, [c.tenantId]);
  const overdue = ds.rows
    .map(serializeDataset)
    .filter((d) => d.nextDueAt && new Date(d.nextDueAt).getTime() < Date.now()).length;
  res.json({
    datasets: Number(row.datasets),
    backups: Number(row.backups),
    retainedBytes: Number(row.retained_bytes),
    stagedRecoveries: Number(row.staged),
    overdueDatasets: overdue,
    ledgerHeight: Number(row.height),
    lastBackupAt: iso(row.last_backup as Date | null),
    unreadNotifications: Number(row.unread),
    openConditions: await openConditionCount(pool, c.tenantId),
  });
}));

router.get("/v1/datasets", handler(async (_req, res) => {
  const r = await pool.query<Record<string, unknown>>(`${DATASET_SQL} GROUP BY d.id ORDER BY d.created_at`, [ctx(res).tenantId]);
  res.json(r.rows.map(serializeDataset));
}));

router.post("/v1/datasets", requireAdmin, handler(async (req, res) => {
  const body = parseBody(RegisterDatasetBody, req);
  if (!body.ownershipConfirmed) throw fail(400, "BAD_REQUEST", "Confirm that you own or are authorized to back up this source.");
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "register_dataset", idempotencyKey: body.idempotencyKey, fingerprint: body },
    async (client, key) => {
      const dup = await client.query("SELECT 1 FROM fortress_datasets WHERE tenant_id = $1 AND source = $2", [c.tenantId, body.source]);
      if (dup.rows.length) throw fail(409, "CONFLICT", "A dataset with this source is already registered.");
      const r = await client.query<Record<string, unknown>>(
        `INSERT INTO fortress_datasets (tenant_id, name, source, retention_days, interval_minutes)
         VALUES ($1,$2,$3,$4,$5) RETURNING *, 0 AS version, NULL::timestamptz AS last_backup_at`,
        [c.tenantId, body.name, body.source, body.retentionDays, body.intervalMinutes],
      );
      await appendEvent(client, c.tenantId, {
        eventType: "DATASET_REGISTERED", actorId: c.userId, idempotencyKey: key,
        meta: { datasetId: r.rows[0]!.id, retentionDays: body.retentionDays, intervalMinutes: body.intervalMinutes },
      });
      return serializeDataset(r.rows[0]!);
    },
  );
  res.json(result);
}));

router.patch("/v1/datasets/:id/policy", requireAdmin, handler(async (req, res) => {
  const id = parseId(req);
  const body = parseBody(UpdatePolicyBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "update_policy", idempotencyKey: body.idempotencyKey, fingerprint: { id, ...body } },
    async (client, key) => {
      const r = await client.query(
        "UPDATE fortress_datasets SET retention_days = $3, interval_minutes = $4 WHERE id = $1 AND tenant_id = $2 RETURNING id",
        [id, c.tenantId, body.retentionDays, body.intervalMinutes],
      );
      if (!r.rows.length) throw fail(404, "NOT_FOUND", "Dataset not found.");
      await appendEvent(client, c.tenantId, {
        eventType: "POLICY_UPDATED", actorId: c.userId, idempotencyKey: key,
        meta: { datasetId: id, retentionDays: body.retentionDays, intervalMinutes: body.intervalMinutes },
      });
      const full = await client.query<Record<string, unknown>>(`${DATASET_SQL} AND d.id = $2 GROUP BY d.id`, [c.tenantId, id]);
      return serializeDataset(full.rows[0]!);
    },
  );
  res.json(result);
}));

router.get("/v1/backups", handler(async (_req, res) => {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT b.*, d.name AS dataset_name FROM fortress_backups b JOIN fortress_datasets d ON d.id = b.dataset_id
     WHERE b.tenant_id = $1 ORDER BY b.created_at DESC LIMIT 200`,
    [ctx(res).tenantId],
  );
  res.json(r.rows.map(serializeBackup));
}));

router.post("/v1/backups", handler(async (req, res) => {
  const body = parseBody(CreateBackupBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    {
      tenantId: c.tenantId, actorId: c.userId, route: "create_backup", idempotencyKey: body.idempotencyKey,
      fingerprint: { datasetId: body.datasetId, dataHash: sha256Hex(JSON.stringify(body.data ?? null)) },
    },
    async (client, key) => serializeBackup(await storeBackup(client, c.tenantId, c.userId, body.datasetId, body.data, "session", key)),
  );
  res.json(result);
}));

router.post("/v1/verify", handler(async (_req, res) => {
  const c = ctx(res);
  let ledger;
  try {
    ledger = await verifyLedgerSnapshot(c.tenantId);
  } catch (err) {
    if (err instanceof LedgerIntegrityError) {
      await recordCondition(c.tenantId, err.code, err.detail);
      throw fail(409, "INTEGRITY_FAILURE", `Ledger verification failed (${err.code}). Recovery is required.`);
    }
    throw err;
  }
  // Read with one connection and release it before anything else needs the
  // pool, so concurrent verifications can never starve each other.
  const counts = { backups: 0, stages: 0, evidence: 0 };
  const sets: Array<[keyof typeof counts, string, (t: string, id: string) => string]> = [
    ["backups", "SELECT * FROM fortress_backups WHERE tenant_id = $1 AND payload_status = 'retained'", backupContext],
    ["stages", "SELECT * FROM fortress_stages WHERE tenant_id = $1 AND status = 'staged'", stageContext],
    ["evidence", "SELECT * FROM fortress_evidence WHERE tenant_id = $1 AND status = 'retained'", evidenceContext],
  ];
  const loaded: Array<[keyof typeof counts, (t: string, id: string) => string, Record<string, unknown>[]]> = [];
  let key: Buffer;
  const client = await pool.connect();
  try {
    key = await getRecoveryKey(client, c.tenantId);
    for (const [name, sql, context] of sets) {
      loaded.push([name, context, (await client.query<Record<string, unknown>>(sql, [c.tenantId])).rows]);
    }
  } finally {
    client.release();
  }
  let failed: { name: string; id: string; err: unknown } | null = null;
  try {
    outer: for (const [name, context, rows] of loaded) {
      for (const row of rows) {
        try {
          openRow(row, key, context(c.tenantId, String(row.id))).fill(0);
        } catch (err) {
          failed = { name, id: String(row.id), err };
          break outer;
        }
        counts[name] += 1;
      }
    }
  } finally {
    key.fill(0);
  }
  if (failed) {
    await recordCondition(c.tenantId, "CIPHERTEXT_AUTH_FAILED", { ref: `${failed.name}:${failed.id}`, kind: failed.name, id: failed.id });
    throw failed.err;
  }
  await withTransaction((tx) => appendEvent(tx, c.tenantId, {
    eventType: "VAULT_VERIFIED", actorId: c.userId,
    meta: { height: ledger.height, backups: counts.backups, stages: counts.stages, evidence: counts.evidence },
  }));
  res.json({
    valid: true,
    ledgerHeight: ledger.height + 1,
    tipHash: ledger.tip,
    backupsChecked: counts.backups,
    stagesChecked: counts.stages,
    evidenceChecked: counts.evidence,
    checkpointsChecked: ledger.checkpointsChecked,
    verifiedAt: new Date().toISOString(),
  });
}));

router.post("/v1/restores/plan", handler(async (req, res) => {
  const body = parseBody(PlanRestoreBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "plan_restore", idempotencyKey: body.idempotencyKey, fingerprint: body },
    async (client, key) => {
      const b = await client.query<Record<string, unknown>>(
        "SELECT * FROM fortress_backups WHERE id = $1 AND tenant_id = $2 AND payload_status = 'retained' AND expires_at > now()",
        [body.backupId, c.tenantId],
      );
      const backup = b.rows[0];
      if (!backup) throw fail(404, "NOT_FOUND", "Backup not found or no longer retained.");
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60_000);
      const confirmation = `RESTORE ${body.backupId} TO ${body.target}`;
      await client.query(
        `INSERT INTO fortress_restore_plans (id, tenant_id, actor, backup_id, target, confirmation_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, c.tenantId, c.userId, body.backupId, body.target, sha256Hex(confirmation), expiresAt],
      );
      await appendEvent(client, c.tenantId, {
        eventType: "RESTORE_DRY_RUN_CREATED", actorId: c.userId, idempotencyKey: key,
        meta: { planId: id, backupId: body.backupId, target: body.target, checksum: backup.checksum },
      });
      return {
        id, backupId: body.backupId, target: body.target, checksum: String(backup.checksum),
        bytes: Number(backup.bytes), expiresAt: expiresAt.toISOString(), confirmation, dryRun: true,
      };
    },
  );
  res.json(result);
}));

router.post("/v1/restores/confirm", handler(async (req, res) => {
  const body = parseBody(ConfirmRestoreBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "confirm_restore", idempotencyKey: body.idempotencyKey, fingerprint: body },
    async (client, key) => {
      const p = await client.query<Record<string, unknown>>(
        "SELECT * FROM fortress_restore_plans WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
        [body.planId, c.tenantId],
      );
      const plan = p.rows[0];
      if (!plan || plan.actor !== c.userId) throw fail(404, "NOT_FOUND", "Restore plan not found.");
      if (plan.used_at) throw fail(409, "CONFLICT", "Restore plan has already been used.");
      const audit = (reason: string) => ({ tenantId: c.tenantId, actorId: c.userId, eventType: "RESTORE_CONFIRMATION_FAILED", meta: { planId: body.planId, reason } });
      if (new Date(plan.expires_at as Date).getTime() <= Date.now()) {
        throw fail(409, "CONFLICT", "Restore plan expired. Create a new dry-run plan.").withAudit(audit("plan_expired"));
      }
      if (!digestsEqual(String(plan.confirmation_hash), sha256Hex(body.confirmation))) {
        throw fail(403, "FORBIDDEN", "Confirmation phrase did not match.").withAudit(audit("phrase_mismatch"));
      }
      const b = await client.query<Record<string, unknown>>(
        "SELECT * FROM fortress_backups WHERE id = $1 AND tenant_id = $2 AND payload_status = 'retained' AND expires_at > now() FOR UPDATE",
        [plan.backup_id, c.tenantId],
      );
      const backup = b.rows[0];
      if (!backup) throw fail(404, "NOT_FOUND", "Backup is no longer available.");
      const master = await getRecoveryKey(client, c.tenantId);
      const plaintext = openRow(backup, master, backupContext(c.tenantId, String(backup.id)));
      const stageId = randomUUID();
      const staged = seal(plaintext, master, stageContext(c.tenantId, stageId));
      plaintext.fill(0);
      master.fill(0);
      if (staged.checksum !== backup.checksum) throw fail(409, "INTEGRITY_FAILURE", "Staging copy checksum differs from its source.");
      const inserted = await client.query<Record<string, unknown>>(
        `INSERT INTO fortress_stages (id, tenant_id, backup_id, target, checksum, ciphertext, nonce, tag,
           wrapped_data_key, data_key_nonce, data_key_tag)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [stageId, c.tenantId, backup.id, plan.target, ...sealedColumns(staged)],
      );
      await client.query("UPDATE fortress_restore_plans SET used_at = now() WHERE id = $1", [plan.id]);
      await appendEvent(client, c.tenantId, {
        eventType: "RESTORE_STAGED", actorId: c.userId, idempotencyKey: key,
        objectRef: `sha256:${staged.checksum}`,
        meta: { stageId, backupId: String(backup.id), target: String(plan.target), sourceOverwritten: false },
      });
      return serializeStage(inserted.rows[0]!);
    },
  );
  res.json(result);
}));

router.get("/v1/stages", handler(async (_req, res) => {
  const r = await pool.query<Record<string, unknown>>(
    "SELECT * FROM fortress_stages WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200",
    [ctx(res).tenantId],
  );
  res.json(r.rows.map(serializeStage));
}));

router.get("/v1/stages/:id/data", handler(async (req, res) => {
  const id = parseId(req);
  const c = ctx(res);
  const client = await pool.connect();
  try {
    const r = await client.query<Record<string, unknown>>(
      "SELECT * FROM fortress_stages WHERE id = $1 AND tenant_id = $2 AND status = 'staged'",
      [id, c.tenantId],
    );
    const stage = r.rows[0];
    if (!stage) throw fail(404, "NOT_FOUND", "Staged recovery not found.");
    const key = await getRecoveryKey(client, c.tenantId);
    const bytes = openRow(stage, key, stageContext(c.tenantId, id));
    key.fill(0);
    res.json({ stageId: id, checksum: String(stage.checksum), data: JSON.parse(bytes.toString("utf8")) as unknown });
  } finally {
    client.release();
  }
}));

router.post("/v1/stages/:id/rollback", handler(async (req, res) => {
  const id = parseId(req);
  const body = parseBody(RollbackStageBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "rollback_stage", idempotencyKey: body.idempotencyKey, fingerprint: { id } },
    async (client, key) => {
      const r = await client.query<Record<string, unknown>>(
        `UPDATE fortress_stages SET status = 'rolled_back', ciphertext = NULL, nonce = NULL, tag = NULL,
           wrapped_data_key = NULL, data_key_nonce = NULL, data_key_tag = NULL
         WHERE id = $1 AND tenant_id = $2 AND status = 'staged' RETURNING *`,
        [id, c.tenantId],
      );
      if (!r.rows[0]) throw fail(404, "NOT_FOUND", "Staged recovery not found or already rolled back.");
      await appendEvent(client, c.tenantId, { eventType: "RESTORE_ROLLED_BACK", actorId: c.userId, idempotencyKey: key, meta: { stageId: id } });
      return serializeStage(r.rows[0]);
    },
  );
  res.json(result);
}));

router.post("/v1/retention", requireAdmin, handler(async (req, res) => {
  const body = parseBody(ApplyRetentionBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "apply_retention", idempotencyKey: body.idempotencyKey, fingerprint: {} },
    async (client, key) => {
      const r = await client.query(
        `UPDATE fortress_backups SET payload_status = 'purged', ciphertext = NULL, nonce = NULL, tag = NULL,
           wrapped_data_key = NULL, data_key_nonce = NULL, data_key_tag = NULL
         WHERE tenant_id = $1 AND payload_status = 'retained' AND expires_at <= now()
           AND NOT EXISTS (SELECT 1 FROM fortress_stages s WHERE s.backup_id = fortress_backups.id AND s.status = 'staged')
         RETURNING id`,
        [c.tenantId],
      );
      await appendEvent(client, c.tenantId, { eventType: "RETENTION_APPLIED", actorId: c.userId, idempotencyKey: key, meta: { purged: r.rows.length } });
      return { purged: r.rows.length };
    },
  );
  res.json(result);
}));

router.get("/v1/events", handler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200) || 200, 500);
  const r = await pool.query<Record<string, unknown>>(
    "SELECT * FROM fortress_events WHERE tenant_id = $1 ORDER BY idx DESC LIMIT $2",
    [ctx(res).tenantId, limit],
  );
  res.json(r.rows.map((row) => ({
    v: Number(row.v),
    idx: Number(row.idx),
    eventId: String(row.event_id),
    occurredAt: new Date(Math.floor(Number(row.occurred_at_us) / 1000)).toISOString(),
    eventType: String(row.event_type),
    actorId: String(row.actor_id),
    objectRef: String(row.object_ref),
    prevHash: String(row.prev_hash),
    hash: String(row.hash),
    meta: row.meta as Record<string, unknown>,
  })));
}));

router.get("/v1/members", handler(async (_req, res) => {
  const r = await pool.query<{ user_id: string; role: string }>(
    "SELECT user_id, role FROM fortress_members WHERE tenant_id = $1 ORDER BY created_at",
    [ctx(res).tenantId],
  );
  res.json(r.rows.map((m) => ({ userId: m.user_id, role: m.role })));
}));

router.post("/v1/members", requireAdmin, handler(async (req, res) => {
  const body = parseBody(SetMemberBody, req);
  const c = ctx(res);
  if (body.userId === c.userId) throw fail(400, "BAD_REQUEST", "You cannot change your own role.");
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "set_member", idempotencyKey: body.idempotencyKey, fingerprint: body },
    async (client, key) => {
      const owner = await client.query("SELECT 1 FROM fortress_tenants WHERE id = $1 AND owner_user_id = $2", [c.tenantId, body.userId]);
      if (owner.rows.length) throw fail(400, "BAD_REQUEST", "The tenant owner's role cannot be changed.");
      if (body.role === "removed") {
        await client.query("DELETE FROM fortress_members WHERE tenant_id = $1 AND user_id = $2", [c.tenantId, body.userId]);
      } else {
        await client.query(
          `INSERT INTO fortress_members (tenant_id, user_id, role) VALUES ($1,$2,$3)
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = $3`,
          [c.tenantId, body.userId, body.role],
        );
      }
      await appendEvent(client, c.tenantId, { eventType: "MEMBER_CHANGED", actorId: c.userId, idempotencyKey: key, meta: { member: body.userId, role: body.role } });
      return { userId: body.userId, role: body.role };
    },
  );
  res.json(result);
}));

async function integrityState(tenantId: string) {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT * FROM fortress_integrity_conditions WHERE (tenant_id = $1 OR tenant_id IS NULL)
     ORDER BY detected_at DESC LIMIT 100`,
    [tenantId],
  );
  const conditions = r.rows.map((row) => ({
    id: String(row.id),
    scope: (row.tenant_id ? "tenant" : "installation") as "tenant" | "installation",
    code: String(row.code),
    detail: row.detail as Record<string, unknown>,
    detectedAt: isoReq(row.detected_at as Date),
    resolvedAt: iso(row.resolved_at as Date | null),
  }));
  return { recoveryRequired: conditions.some((x) => !x.resolvedAt), conditions };
}

router.get("/v1/integrity", handler(async (_req, res) => {
  res.json(await integrityState(ctx(res).tenantId));
}));

const VAULT_SETS: Record<string, { table: string; live: string; context: (t: string, id: string) => string }> = {
  backups: { table: "fortress_backups", live: "payload_status = 'retained'", context: backupContext },
  stages: { table: "fortress_stages", live: "status = 'staged'", context: stageContext },
  evidence: { table: "fortress_evidence", live: "status = 'retained'", context: evidenceContext },
};

interface OpenCondition {
  id: string;
  tenant_id: string | null;
  code: string;
  detail: Record<string, unknown>;
}

/**
 * Decide whether one open condition has really been cleared, using a check
 * specific to its kind. Returns null when cleared, otherwise the reason it
 * still stands.
 */
async function conditionStillHolds(cond: OpenCondition, tenantId: string, ledgerOk: boolean): Promise<string | null> {
  switch (cond.code) {
    case "TRUST_KEY_MISMATCH": {
      const pinned = await pool.query<{ trust_key: string }>("SELECT trust_key FROM fortress_installation WHERE id = 'singleton'");
      return pinned.rows[0]?.trust_key === currentTrustKey() ? null : "the signing key still differs from the pinned installation key";
    }
    case "CIPHERTEXT_AUTH_FAILED": {
      const set = VAULT_SETS[String(cond.detail.kind)];
      const id = String(cond.detail.id ?? "");
      if (!set || !/^[0-9a-f-]{36}$/i.test(id)) return "the failing item is not identified; restore from a verified .pfr package";
      const r = await pool.query<Record<string, unknown>>(`SELECT * FROM ${set.table} WHERE id = $1 AND tenant_id = $2 AND ${set.live}`, [id, tenantId]);
      if (!r.rows[0]) return null; // no longer retained, nothing left to fail
      const client = await pool.connect();
      try {
        const key = await getRecoveryKey(client, tenantId);
        try {
          openRow(r.rows[0], key, set.context(tenantId, id)).fill(0);
          return null;
        } catch {
          return `the ${String(cond.detail.kind)} item still fails authentication`;
        } finally {
          key.fill(0);
        }
      } finally {
        client.release();
      }
    }
    case "CHECKPOINT_CONTRADICTION":
    case "CHECKPOINT_BEYOND_TIP": {
      const signed = cond.detail.signed as SignedCheckpoint | undefined;
      if (!signed?.checkpoint) return "no signed proof was stored with this condition; restore from a verified .pfr package";
      const manifest = await loadManifest(pool, tenantId);
      const trusted = await trustedCheckpointSigners(pool, tenantId, manifest);
      // A checkpoint whose signer has since been revoked no longer counts as evidence.
      if (!verifyCheckpoint(signed, trusted).ok) return null;
      const at = await pool.query<{ hash: string }>(
        "SELECT hash FROM fortress_events WHERE tenant_id = $1 AND idx = $2",
        [tenantId, signed.checkpoint.height],
      );
      if (ledgerOk && at.rows[0]?.hash === signed.checkpoint.tip_hash) return null;
      return "the imported checkpoint still contradicts local history (restore the missing history or revoke its signer)";
    }
    default:
      return ledgerOk ? null : "ledger verification still fails";
  }
}

/**
 * Resolve each open condition only when its own check passes. Cleared
 * conditions are committed; anything that still holds is reported with 409.
 */
router.post("/v1/integrity/resolve", requireAdmin, handler(async (req, res) => {
  const body = parseBody(ResolveIntegrityBody, req);
  const c = ctx(res);
  let ledgerOk = true;
  let ledgerCode: string | null = null;
  try {
    await verifyLedgerSnapshot(c.tenantId);
  } catch (err) {
    if (!(err instanceof LedgerIntegrityError)) throw err;
    ledgerOk = false;
    ledgerCode = err.code;
  }
  const open = await pool.query<OpenCondition>(
    "SELECT id, tenant_id, code, detail FROM fortress_integrity_conditions WHERE resolved_at IS NULL AND (tenant_id = $1 OR tenant_id IS NULL)",
    [c.tenantId],
  );
  const cleared: OpenCondition[] = [];
  const remaining: Array<{ code: string; reason: string }> = [];
  for (const cond of open.rows) {
    const reason = await conditionStillHolds(cond, c.tenantId, ledgerOk);
    if (reason === null) cleared.push(cond);
    else remaining.push({ code: cond.code, reason });
  }
  if (!ledgerOk && !remaining.some((r) => r.reason === "ledger verification still fails")) {
    // The ledger fails now even though no ledger condition was open yet: record it.
    await recordCondition(c.tenantId, ledgerCode!, {});
    remaining.push({ code: ledgerCode!, reason: "ledger verification still fails" });
  }
  if (cleared.length) {
    await withTransaction(async (tx) => {
      await tx.query(
        "UPDATE fortress_integrity_conditions SET resolved_at = now(), resolved_by = $2 WHERE id = ANY($1::uuid[]) AND resolved_at IS NULL",
        [cleared.map((x) => x.id), c.userId],
      );
      await appendEvent(tx, c.tenantId, {
        eventType: "INTEGRITY_RESOLVED", actorId: c.userId, idempotencyKey: body.idempotencyKey,
        meta: { resolved: cleared.map((x) => x.code), remaining: remaining.map((x) => x.code) }, skipIntegrityGate: true,
      });
    });
  }
  if (remaining.length) {
    const summary = remaining.map((r) => `${r.code}: ${r.reason}`).join("; ");
    throw fail(409, "INTEGRITY_FAILURE", `Verification still fails (${summary}). Restore from a verified .pfr package or archive first.`);
  }
  res.json(await integrityState(c.tenantId));
}));

export default router;
