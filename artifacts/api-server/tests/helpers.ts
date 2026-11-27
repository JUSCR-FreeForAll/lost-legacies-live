import "./env";
import assert from "node:assert/strict";
import { rmSync, mkdirSync } from "node:fs";
import request from "supertest";
import { pool } from "@workspace/db";
import { createApp } from "../src/app";
import type { AuthProvider, SessionRevoker } from "../src/fortress/auth";
import { startupVerification } from "../src/fortress/integrity";

/** Fake provider session store: sessions per user with creation time (ms). */
export const providerSessions = new Map<string, Array<{ id: string; createdAt: number }>>();
export const providerRevocations: string[] = [];
export const providerFault = { list: false, revoke: false };

export function addProviderSession(userId: string, id: string, createdAt = Date.now() - 60_000): void {
  const list = providerSessions.get(userId) ?? [];
  list.push({ id, createdAt });
  providerSessions.set(userId, list);
}

/** Header-driven identity so tests can play several users and sessions. */
export const testAuth: AuthProvider = {
  name: "test-headers",
  identify(req) {
    const userId = req.header("x-test-user");
    if (!userId) return null;
    const iat = req.header("x-test-iat");
    return { userId, sessionId: req.header("x-test-session") ?? null, issuedAt: iat ? Number(iat) : Math.floor(Date.now() / 1000) + 1 };
  },
  async sessionCreatedAt(req, sessionId) {
    const userId = req.header("x-test-user") ?? "";
    const s = providerSessions.get(userId)?.find((x) => x.id === sessionId);
    return s ? Math.floor(s.createdAt / 1000) : null;
  },
};

export const testRevoker: SessionRevoker = {
  name: "test-double",
  async listActiveSessions(userId) {
    if (providerFault.list) throw new Error("provider unavailable");
    return [...(providerSessions.get(userId) ?? [])];
  },
  async revokeSession(sessionId) {
    if (providerFault.revoke) throw new Error("provider unavailable");
    providerRevocations.push(sessionId);
    for (const [u, list] of providerSessions) providerSessions.set(u, list.filter((s) => s.id !== sessionId));
  },
};

export const app = createApp({ authProvider: testAuth, sessionRevoker: testRevoker });

export async function resetDb(): Promise<void> {
  const db = await pool.query<{ db: string }>("SELECT current_database() AS db");
  assert.ok(db.rows[0]!.db.endsWith("_test"), `refusing to reset non-test database ${db.rows[0]!.db}`);
  const t = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'fortress\\_%'",
  );
  await pool.query(`TRUNCATE ${t.rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`);
  rmSync(process.env.FORTRESS_ARCHIVE_DIR!, { recursive: true, force: true });
  mkdirSync(process.env.FORTRESS_ARCHIVE_DIR!, { recursive: true });
  providerRevocations.length = 0;
  providerSessions.clear();
  providerFault.list = false;
  providerFault.revoke = false;
  assert.ok(await startupVerification(), "startup verification must succeed on a clean test database");
}

let counter = 0;
export const ik = (label = "op") => `${label}-${process.pid}-${Date.now()}-${++counter}`;

export interface Client {
  user: string;
  session: string;
  get(p: string): request.Test;
  post(p: string, body?: unknown): request.Test;
  put(p: string, body?: unknown): request.Test;
  patch(p: string, body?: unknown): request.Test;
}

export function as(user: string, session = `sess_${user}`, iat?: number, tenant?: string): Client {
  const headers: Record<string, string> = { "x-test-user": user, "x-test-session": session };
  if (iat !== undefined) headers["x-test-iat"] = String(iat);
  if (tenant) headers["x-tenant-id"] = tenant;
  return {
    user,
    session,
    get: (p) => request(app).get(`/api${p}`).set(headers),
    post: (p, body = {}) => request(app).post(`/api${p}`).set(headers).send(body as object),
    put: (p, body = {}) => request(app).put(`/api${p}`).set(headers).send(body as object),
    patch: (p, body = {}) => request(app).patch(`/api${p}`).set(headers).send(body as object),
  };
}

export const anon = () => ({
  get: (p: string) => request(app).get(`/api${p}`),
  post: (p: string, body: unknown = {}, bearer?: string) => {
    const r = request(app).post(`/api${p}`);
    if (bearer) r.set("Authorization", `Bearer ${bearer}`);
    return r.send(body as object);
  },
});

export function expectStatus(res: request.Response, status: number, code?: string): void {
  assert.equal(res.status, status, `expected ${status}${code ? ` ${code}` : ""}, got ${res.status}: ${JSON.stringify(res.body)}`);
  if (code) assert.equal(res.body.code, code);
}

/** Owner with an active recovery key and one dataset. */
export async function setupOwner(user = "user_owner") {
  const c = as(user);
  const me = await c.get("/v1/me");
  expectStatus(me, 200);
  const setup = await c.post("/v1/recovery/setup");
  expectStatus(setup, 200);
  const confirm = await c.post("/v1/recovery/confirm", { recoveryKey: setup.body.recoveryKey, idempotencyKey: ik("confirm") });
  expectStatus(confirm, 200);
  const ds = await c.post("/v1/datasets", {
    name: "Journal", source: `src-${user}`, ownershipConfirmed: true, retentionDays: 30, intervalMinutes: 1440, idempotencyKey: ik("ds"),
  });
  expectStatus(ds, 200);
  return { c, tenantId: me.body.tenantId as string, recoveryKey: setup.body.recoveryKey as string, datasetId: ds.body.id as string };
}

export async function backup(c: Client, datasetId: string, data: unknown) {
  const r = await c.post("/v1/backups", { datasetId, data, idempotencyKey: ik("bk") });
  expectStatus(r, 200);
  return r.body as { id: string; checksum: string; version: number };
}

export async function grant(c: Client, purpose: string) {
  expectStatus(await c.put(`/v1/consents/${purpose}`, { state: "granted", idempotencyKey: ik("consent") }), 200);
}

export { pool };
