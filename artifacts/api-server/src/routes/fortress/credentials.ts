import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { pool } from "@workspace/db";
import {
  CreateEncryptedExportBody,
  IngestBackupBody,
  IssueCredentialBody,
  RevokeAllCredentialsBody,
  RevokeCredentialBody,
} from "@workspace/api-zod";
import { canonicalize, sha256Hex } from "@workspace/fortress-core";
import { fail } from "../../fortress/errors";
import { ctx, handler, iso, isoReq, parseBody, parseId } from "../../fortress/http";
import { requireAdmin } from "../../fortress/auth";
import { appendEvent } from "../../fortress/ledger";
import { runIdempotent, withTransaction } from "../../fortress/tx";
import { throttle } from "../../fortress/throttle";
import { installationName } from "../../fortress/keys";
import { requireConsent } from "../../fortress/protection";
import { addTombstone, revokeAllCredentials } from "../../fortress/recoveryOps";
import { rowCiphertext } from "../../fortress/vault";
import { serializeBackup, storeBackup } from "./core";

export const EXPORT_MAX_MINUTES = 15;
export const INGEST_MAX_MINUTES = 129_600;

const hashToken = (token: string) => sha256Hex(`phoenix-fortress:credential:v1:${token}`);

function serializeCredential(row: Record<string, unknown>) {
  return {
    id: String(row.id), name: String(row.name), datasetId: String(row.dataset_id),
    kind: String(row.kind) as "export" | "ingest", prefix: String(row.token_prefix),
    expiresAt: isoReq(row.expires_at as Date), revoked: Boolean(row.revoked),
    usedAt: iso(row.used_at as Date | null), useCount: Number(row.use_count),
  };
}

/** Owner/admin-facing credential management. */
export const credentialAdminRouter: IRouter = Router();

credentialAdminRouter.get("/v1/credentials", handler(async (_req, res) => {
  const r = await pool.query<Record<string, unknown>>("SELECT * FROM fortress_credentials WHERE tenant_id = $1 ORDER BY created_at DESC", [ctx(res).tenantId]);
  res.json(r.rows.map(serializeCredential));
}));

credentialAdminRouter.post("/v1/credentials", requireAdmin, handler(async (req, res) => {
  const body = parseBody(IssueCredentialBody, req);
  const c = ctx(res);
  const max = body.kind === "export" ? EXPORT_MAX_MINUTES : INGEST_MAX_MINUTES;
  if (body.expiresInMinutes > max) throw fail(400, "BAD_REQUEST", `${body.kind} credentials can last at most ${max} minutes.`);
  const token = `pf_${randomBytes(32).toString("base64url")}`;
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "issue_credential", idempotencyKey: body.idempotencyKey, fingerprint: body },
    async (client, key) => {
      const ds = await client.query("SELECT 1 FROM fortress_datasets WHERE id = $1 AND tenant_id = $2", [body.datasetId, c.tenantId]);
      if (!ds.rows.length) throw fail(404, "NOT_FOUND", "Dataset not found.");
      if (body.kind === "ingest") await requireConsent(client, c.tenantId, "juscr_ingest");
      const r = await client.query<Record<string, unknown>>(
        `INSERT INTO fortress_credentials (tenant_id, dataset_id, kind, name, token_hash, token_prefix, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6, now() + ($7::int * interval '1 minute')) RETURNING *`,
        [c.tenantId, body.datasetId, body.kind, body.name, hashToken(token), token.slice(0, 10), body.expiresInMinutes],
      );
      await appendEvent(client, c.tenantId, {
        eventType: "CREDENTIAL_ISSUED", actorId: c.userId, idempotencyKey: key,
        meta: { credentialId: r.rows[0]!.id, kind: body.kind, datasetId: body.datasetId, expiresInMinutes: body.expiresInMinutes },
      });
      return { credential: serializeCredential(r.rows[0]!), token };
    },
    (saved) => ({ ...saved, token: null as unknown as string }),
  );
  res.setHeader("Cache-Control", "no-store");
  res.json(result);
}));

credentialAdminRouter.post("/v1/credentials/:id/revoke", requireAdmin, handler(async (req, res) => {
  const id = parseId(req);
  const body = parseBody(RevokeCredentialBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "revoke_credential", idempotencyKey: body.idempotencyKey, fingerprint: { id } },
    async (client, key) => {
      const r = await client.query<Record<string, unknown>>(
        "UPDATE fortress_credentials SET revoked = true WHERE id = $1 AND tenant_id = $2 RETURNING *",
        [id, c.tenantId],
      );
      if (!r.rows[0]) throw fail(404, "NOT_FOUND", "Credential not found.");
      await addTombstone(client, c.tenantId, "credential", id, installationName());
      await appendEvent(client, c.tenantId, { eventType: "CREDENTIAL_REVOKED", actorId: c.userId, idempotencyKey: key, meta: { credentialId: id } });
      return serializeCredential(r.rows[0]);
    },
  );
  res.json(result);
}));

credentialAdminRouter.post("/v1/credentials/revoke-all", requireAdmin, handler(async (req, res) => {
  const body = parseBody(RevokeAllCredentialsBody, req);
  const c = ctx(res);
  const result = await runIdempotent(
    { tenantId: c.tenantId, actorId: c.userId, route: "revoke_all_credentials", idempotencyKey: body.idempotencyKey, fingerprint: {} },
    async (client, key) => {
      const count = await revokeAllCredentials(client, c.tenantId, installationName());
      await appendEvent(client, c.tenantId, { eventType: "CREDENTIALS_REVOKED_ALL", actorId: c.userId, idempotencyKey: key, meta: { count } });
      return { count };
    },
  );
  res.json(result);
}));

interface CredentialRow {
  id: string; tenant_id: string; dataset_id: string; kind: string; revoked: boolean; used_at: Date | null; expires_at: Date;
}

async function authenticateCredential(req: Request, kind: "export" | "ingest"): Promise<CredentialRow> {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(pf_[A-Za-z0-9_-]{43})$/.exec(header);
  if (!match) throw fail(401, "UNAUTHENTICATED", "A valid bearer credential is required.");
  const r = await pool.query<CredentialRow>("SELECT * FROM fortress_credentials WHERE token_hash = $1", [hashToken(match[1]!)]);
  const cred = r.rows[0];
  if (!cred || cred.revoked || cred.expires_at.getTime() <= Date.now()) {
    throw fail(401, "UNAUTHENTICATED", "Credential is invalid, revoked or expired.");
  }
  if (cred.kind !== kind) throw fail(403, "FORBIDDEN", `This credential cannot be used for ${kind}.`);
  const tomb = await pool.query("SELECT 1 FROM fortress_revocation_tombstones WHERE tenant_id = $1 AND kind = 'credential' AND item_id = $2", [cred.tenant_id, cred.id]);
  if (tomb.rows.length) throw fail(401, "UNAUTHENTICATED", "Credential is invalid, revoked or expired.");
  return cred;
}

/** Bearer-credential endpoints: no Clerk session involved. */
export const credentialApiRouter: IRouter = Router();

credentialApiRouter.post("/v1/exports", handler(async (req, res) => {
  const cred = await authenticateCredential(req, "export");
  await throttle(`export:${cred.id}`, 10, 60_000);
  const body = parseBody(CreateEncryptedExportBody, req);
  const out = await withTransaction(async (client) => {
    const used = await client.query(
      "UPDATE fortress_credentials SET used_at = now(), use_count = use_count + 1 WHERE id = $1 AND used_at IS NULL AND revoked = false RETURNING id",
      [cred.id],
    );
    if (!used.rows.length) throw fail(401, "UNAUTHENTICATED", "Export credentials are single use.");
    const b = await client.query<Record<string, unknown>>(
      "SELECT * FROM fortress_backups WHERE id = $1 AND tenant_id = $2 AND dataset_id = $3 AND payload_status = 'retained'",
      [body.backupId, cred.tenant_id, cred.dataset_id],
    );
    const backup = b.rows[0];
    if (!backup) throw fail(404, "NOT_FOUND", "Backup not found for this credential's dataset.");
    await appendEvent(client, cred.tenant_id, {
      eventType: "ENCRYPTED_EXPORT", actorId: `credential:${cred.id}`, objectRef: `sha256:${String(backup.checksum)}`,
      meta: { backupId: String(backup.id), credentialId: cred.id },
    });
    const { ciphertext, wrapped } = rowCiphertext(backup);
    return {
      manifest: {
        format: "phoenix-fortress-export", version: 1, backupId: String(backup.id), datasetId: cred.dataset_id,
        checksum: String(backup.checksum), bytes: Number(backup.bytes), algorithm: "AES-256-GCM",
        note: "The data key is wrapped by the owner's recovery key. This credential cannot decrypt it.",
      },
      ciphertext: ciphertext.ciphertext, nonce: ciphertext.nonce, tag: ciphertext.tag,
      wrappedDataKey: wrapped.ciphertext, dataKeyNonce: wrapped.nonce, dataKeyTag: wrapped.tag,
    };
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(out);
}));

/** JUSCR (or any system) pushes backups with a write-only, dataset-bound ingest credential. */
credentialApiRouter.post("/v1/ingest/backups", handler(async (req, res) => {
  const cred = await authenticateCredential(req, "ingest");
  await throttle(`ingest:${cred.id}`, 60, 60_000);
  const body = parseBody(IngestBackupBody, req);
  const actor = `credential:${cred.id}`;
  let replay = true;
  const result = await runIdempotent(
    {
      tenantId: cred.tenant_id, actorId: actor, route: "ingest_backup", idempotencyKey: body.idempotencyKey,
      fingerprint: { dataHash: sha256Hex(canonicalizeSafe(body.data)) },
    },
    async (client, key) => {
      replay = false;
      await requireConsent(client, cred.tenant_id, "juscr_ingest");
      await client.query("UPDATE fortress_credentials SET used_at = now(), use_count = use_count + 1 WHERE id = $1", [cred.id]);
      const row = await storeBackup(client, cred.tenant_id, actor, cred.dataset_id, body.data, "ingest", key);
      const b = serializeBackup(row);
      return { backupId: b.id, version: b.version, checksum: b.checksum, bytes: b.bytes, replay: false };
    },
  );
  res.json({ ...result, replay });
}));

function canonicalizeSafe(value: unknown): string {
  try {
    return canonicalize(value ?? null);
  } catch {
    throw fail(400, "BAD_REQUEST", "Data must be plain JSON.");
  }
}
