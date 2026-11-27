/**
 * MVP acceptance gates against the separate fortress_test database.
 */
import {
  addProviderSession, anon, as, backup, expectStatus, grant, ik, pool, providerFault, providerRevocations, providerSessions, resetDb, setupOwner,
} from "./helpers";
import { retryPendingRevocations } from "../src/fortress/sessions";
import { setStartupState } from "../src/fortress/startup";
import { testRevoker } from "./helpers";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalize, genesisBlock, hashBlock, verifyPfr } from "@workspace/fortress-core";
import { tenantManifest, getSigner } from "../src/fortress/keys";
import { loadBlocks } from "../src/fortress/ledger";
import { exportOutbox } from "../src/fortress/outbox";
import { startupVerification } from "../src/fortress/integrity";
import { findRepoRoot } from "../src/fortress/gates";

beforeEach(resetDb);
after(() => pool.end());

async function eventTypes(tenantId: string): Promise<string[]> {
  const r = await pool.query<{ event_type: string }>("SELECT event_type FROM fortress_events WHERE tenant_id = $1 ORDER BY idx", [tenantId]);
  return r.rows.map((x) => x.event_type);
}

test("[G01] a fresh tenant starts with the deterministic expected genesis", async () => {
  const me = await as("user_g01").get("/v1/me");
  expectStatus(me, 200);
  const r = await pool.query<{ hash: string; idx: number }>("SELECT hash, idx FROM fortress_events WHERE tenant_id = $1 ORDER BY idx LIMIT 1", [me.body.tenantId]);
  assert.equal(r.rows[0]!.idx, 0);
  assert.equal(r.rows[0]!.hash, genesisBlock(tenantManifest(me.body.tenantId)).hash);
});

test("[G02][P5-2] boot reaches READY with all network access blocked and no Solana", async () => {
  const realFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    throw new Error("network disabled in test");
  }) as typeof fetch;
  try {
    const { c } = await setupOwner("user_g02");
    await grant(c, "external_anchor");
    expectStatus(await c.post("/v1/resilience/checkpoints", { idempotencyKey: ik() }), 200);
    expectStatus(await c.post("/v1/anchors", { idempotencyKey: ik() }), 200);
    await startupVerification();
    const ready = await anon().get("/readyz");
    expectStatus(ready, 200);
    assert.equal(ready.body.status, "ready");
    expectStatus(await anon().get("/healthz"), 200);
    expectStatus(await c.post("/v1/verify"), 200);
    assert.equal(attempts, 0, "no network call was attempted");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("[G03] a tampered block fails closed: verify rejects, readiness is RECOVERY_REQUIRED, writes pause", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_g03");
  await backup(c, datasetId, { note: "first" });
  const original = await pool.query<{ meta: unknown }>("SELECT meta FROM fortress_events WHERE tenant_id = $1 AND idx = 2", [tenantId]);
  await pool.query("UPDATE fortress_events SET meta = $2 WHERE tenant_id = $1 AND idx = 2", [tenantId, JSON.stringify({ forged: true })]);

  expectStatus(await c.post("/v1/verify"), 409, "INTEGRITY_FAILURE");
  const ready = await anon().get("/readyz");
  expectStatus(ready, 503);
  assert.equal(ready.body.status, "RECOVERY_REQUIRED");
  expectStatus(await c.post("/v1/backups", { datasetId, data: { x: 1 }, idempotencyKey: ik() }), 503, "RECOVERY_REQUIRED");
  assert.equal((await c.get("/v1/me")).body.recoveryRequired, true);

  // Startup verification on its own also flags it.
  await pool.query("UPDATE fortress_integrity_conditions SET resolved_at = now()");
  await startupVerification();
  assert.equal((await anon().get("/readyz")).body.status, "RECOVERY_REQUIRED");

  // Resolution is refused while the ledger is still bad, then allowed once repaired.
  expectStatus(await c.post("/v1/integrity/resolve", { idempotencyKey: ik() }), 409, "INTEGRITY_FAILURE");
  await pool.query("UPDATE fortress_events SET meta = $2 WHERE tenant_id = $1 AND idx = 2", [tenantId, JSON.stringify(original.rows[0]!.meta)]);
  expectStatus(await c.post("/v1/integrity/resolve", { idempotencyKey: ik() }), 200);
  expectStatus(await anon().get("/readyz"), 200);
});

test("[G04] a fully rewritten, self-consistent ledger is caught by the signed checkpoint", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_g04");
  await backup(c, datasetId, { v: 1 });
  expectStatus(await c.post("/v1/resilience/checkpoints", { idempotencyKey: ik() }), 200);
  // Rewrite every block after genesis with altered content and recomputed hashes.
  const blocks = await loadBlocks(pool, tenantId);
  let prev = blocks[0]!.hash;
  for (const b of blocks.slice(1)) {
    const body = { ...b, actor_id: "attacker", prev_hash: prev };
    const { hash: _old, ...unsigned } = body;
    const hash = hashBlock(unsigned);
    await pool.query("UPDATE fortress_events SET actor_id = 'attacker', prev_hash = $3, hash = $4 WHERE tenant_id = $1 AND idx = $2", [tenantId, b.idx, prev, hash]);
    prev = hash;
  }
  await pool.query("UPDATE fortress_tenants SET head_hash = $2 WHERE id = $1", [tenantId, prev]);
  const res = await c.post("/v1/verify");
  expectStatus(res, 409, "INTEGRITY_FAILURE");
  assert.match(res.body.error, /CHECKPOINT_CONTRADICTION/);
  assert.equal((await anon().get("/readyz")).body.status, "RECOVERY_REQUIRED");
});

test("[G05] concurrent commits never duplicate or lose a block", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_g05");
  const before = (await pool.query<{ n: string }>("SELECT count(*) AS n FROM fortress_events WHERE tenant_id = $1", [tenantId])).rows[0]!.n;
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => c.post("/v1/backups", { datasetId, data: { i }, idempotencyKey: ik("conc") })));
  for (const r of results) expectStatus(r, 200);
  const rows = await pool.query<{ idx: number }>("SELECT idx FROM fortress_events WHERE tenant_id = $1 ORDER BY idx", [tenantId]);
  assert.equal(rows.rows.length, Number(before) + 100);
  rows.rows.forEach((r, i) => assert.equal(Number(r.idx), i));
  const versions = new Set(results.map((r) => r.body.version));
  assert.equal(versions.size, 100);
  expectStatus(await c.post("/v1/verify"), 200);
});

test("[G06] replaying a request with the same idempotency key does not mutate twice", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_g06");
  const key = ik("replay");
  const a = await c.post("/v1/backups", { datasetId, data: { same: true }, idempotencyKey: key });
  const b = await c.post("/v1/backups", { datasetId, data: { same: true }, idempotencyKey: key });
  expectStatus(a, 200);
  expectStatus(b, 200);
  assert.equal(a.body.id, b.body.id);
  const n = await pool.query<{ n: string }>("SELECT count(*) AS n FROM fortress_backups WHERE tenant_id = $1", [tenantId]);
  assert.equal(Number(n.rows[0]!.n), 1);
  expectStatus(await c.post("/v1/backups", { datasetId, data: { different: true }, idempotencyKey: key }), 409, "IDEMPOTENCY_CONFLICT");
  // Another user cannot replay someone else's key into their tenant result either.
  const other = await setupOwner("user_g06b");
  const x = await other.c.post("/v1/backups", { datasetId: other.datasetId, data: { same: true }, idempotencyKey: key });
  expectStatus(x, 200);
  assert.notEqual(x.body.id, a.body.id);
});

test("[G07] the JSONL outbox export resumes safely after a crash mid-write and rebuilds a lost archive", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_g07");
  await exportOutbox();
  const file = path.join(process.env.FORTRESS_ARCHIVE_DIR!, `${tenantId}.jsonl`);
  const first = readFileSync(file, "utf8").trimEnd().split("\n").length;
  await backup(c, datasetId, { more: 1 });
  await backup(c, datasetId, { more: 2 });
  // Simulated crash: half a line written, rows still marked pending.
  appendFileSync(file, '{"idx":99999,"partial":');
  await exportOutbox();
  const lines = readFileSync(file, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l) as { idx: number });
  assert.ok(lines.length > first);
  lines.forEach((l, i) => assert.equal(l.idx, i));
  const head = await pool.query<{ head_idx: number }>("SELECT head_idx FROM fortress_tenants WHERE id = $1", [tenantId]);
  assert.equal(lines.length, Number(head.rows[0]!.head_idx) + 1);
  const pending = await pool.query<{ n: string }>("SELECT count(*) AS n FROM fortress_outbox WHERE exported_at IS NULL AND tenant_id = $1", [tenantId]);
  assert.equal(Number(pending.rows[0]!.n), 0);
  // Archive deleted: rebuilt from the outbox table.
  rmSync(file);
  await exportOutbox();
  assert.equal(readFileSync(file, "utf8").trimEnd().split("\n").length, lines.length);
});

test("[G08] lost device: a saved recovery code restores control and data stays decryptable", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_g08");
  const data = { diary: "entry", n: 42 };
  const bk = await backup(c, datasetId, data);
  const codes = await c.post("/v1/recovery/codes", { idempotencyKey: ik() });
  expectStatus(codes, 200);
  assert.equal(codes.body.codes.length, 10);

  const oldDevice = as("user_g08", "sess_old", Math.floor(Date.now() / 1000) - 600);
  const newDevice = as("user_g08", "sess_new");
  addProviderSession("user_g08", "sess_old", Date.now() - 600_000);
  addProviderSession("user_g08", "sess_new", Date.now() - 10_000);
  expectStatus(await newDevice.post("/v1/recovery/emergency", { recoveryCode: "AAAAA-BBBBB-CCCCC-DDDDD", idempotencyKey: ik() }), 403, "RECOVERY_CODE_INVALID");
  assert.ok((await eventTypes(tenantId)).includes("RECOVERY_CODE_REJECTED"), "failed attempt is audited");

  const res = await newDevice.post("/v1/recovery/emergency", { recoveryCode: codes.body.codes[0].toLowerCase(), idempotencyKey: ik() });
  expectStatus(res, 200);
  assert.equal(res.body.sessionsRevoked, true);
  assert.equal(res.body.newCodes.length, 10);
  assert.ok(res.body.recoveryKey);
  assert.deepEqual(providerRevocations, ["sess_old"], "only the other device is ended at the provider");
  assert.equal(res.body.providerRevocationPending, false);
  // Replaying the same request never re-issues or reveals the one-time secrets.
  const replayKey = ik("em");
  const third = await newDevice.post("/v1/recovery/emergency", { recoveryCode: codes.body.codes[2], idempotencyKey: replayKey });
  expectStatus(third, 403, "RECOVERY_CODE_INVALID"); // codes were voided by the reset

  expectStatus(await oldDevice.get("/v1/me"), 401, "SESSION_REVOKED");
  expectStatus(await newDevice.get("/v1/me"), 200);
  expectStatus(await newDevice.post("/v1/recovery/emergency", { recoveryCode: codes.body.codes[0], idempotencyKey: ik() }), 403, "RECOVERY_CODE_INVALID");
  expectStatus(await newDevice.post("/v1/recovery/emergency", { recoveryCode: codes.body.codes[1], idempotencyKey: ik() }), 403, "RECOVERY_CODE_INVALID");

  // Activate the replacement key; every data key is rewrapped and still opens.
  expectStatus(await newDevice.post("/v1/recovery/rotate/confirm", { recoveryKey: res.body.recoveryKey, idempotencyKey: ik() }), 200);
  expectStatus(await newDevice.post("/v1/verify"), 200);
  const plan = await newDevice.post("/v1/restores/plan", { backupId: bk.id, target: "recovered-copy", idempotencyKey: ik() });
  expectStatus(plan, 200);
  const stage = await newDevice.post("/v1/restores/confirm", { planId: plan.body.id, confirmation: plan.body.confirmation, idempotencyKey: ik() });
  expectStatus(stage, 200);
  const staged = await newDevice.get(`/v1/stages/${stage.body.id}/data`);
  assert.deepEqual(staged.body.data, data);
});

test("[G09] stolen device: other sessions and every API credential are revoked", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_g09");
  await grant(c, "juscr_ingest");
  const ingest = await c.post("/v1/credentials", { name: "juscr", datasetId, kind: "ingest", expiresInMinutes: 600, idempotencyKey: ik() });
  expectStatus(ingest, 200);
  const exp = await c.post("/v1/credentials", { name: "exp", datasetId, kind: "export", expiresInMinutes: 10, idempotencyKey: ik() });
  expectStatus(exp, 200);
  expectStatus(await anon().post("/v1/ingest/backups", { data: { ok: 1 }, idempotencyKey: ik() }, ingest.body.token), 200);
  // Credentials never open user routes.
  const asBearer = await anon().get("/v1/me").set("Authorization", `Bearer ${ingest.body.token}`);
  expectStatus(asBearer, 403, "FORBIDDEN");

  const thief = as("user_g09", "sess_thief", Math.floor(Date.now() / 1000) - 300);
  addProviderSession("user_g09", "sess_thief", Date.now() - 300_000);
  addProviderSession("user_g09", "sess_owner_now", Date.now() - 5_000);
  expectStatus(await thief.get("/v1/me"), 200);
  const owner = as("user_g09", "sess_owner_now");
  expectStatus(await owner.post("/v1/security/sessions/revoke", { idempotencyKey: ik() }), 200);
  expectStatus(await thief.get("/v1/me"), 401, "SESSION_REVOKED");
  // A freshly refreshed token from the revoked session is still refused.
  expectStatus(await as("user_g09", "sess_thief", Math.floor(Date.now() / 1000) + 5).get("/v1/me"), 401, "SESSION_REVOKED");
  expectStatus(await owner.get("/v1/me"), 200);
  assert.deepEqual(providerRevocations, ["sess_thief"]);

  const all = await owner.post("/v1/credentials/revoke-all", { idempotencyKey: ik() });
  expectStatus(all, 200);
  assert.equal(all.body.count, 2);
  expectStatus(await anon().post("/v1/ingest/backups", { data: { ok: 2 }, idempotencyKey: ik() }, ingest.body.token), 401, "UNAUTHENTICATED");
  expectStatus(await anon().post("/v1/exports", { backupId: "x" }, exp.body.token), 401, "UNAUTHENTICATED");
  const tomb = await pool.query("SELECT 1 FROM fortress_revocation_tombstones WHERE tenant_id = $1 AND kind = 'credential'", [tenantId]);
  assert.equal(tomb.rows.length, 2);
});

test("[G10] ransomware drill: a .pfr package verifies and decrypts offline with only the verifier", async () => {
  const { c, recoveryKey, datasetId } = await setupOwner("user_g10");
  const data = { ledger: ["a", "b"], amount: 12 };
  await backup(c, datasetId, data);
  await grant(c, "evidence_storage");
  expectStatus(await c.post("/v1/evidence", { label: "photo note", content: "evidence text", idempotencyKey: ik() }), 200);
  const pkg = await c.get("/v1/recovery/package").buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (d: Buffer) => chunks.push(d));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });
  expectStatus(pkg, 200);
  const archive = pkg.body as Buffer;
  const trust = getSigner().keyId;
  const { report } = verifyPfr(archive, [trust]);
  assert.equal(report.ok, true, report.failures.join(","));
  assert.equal(report.items, 2);

  // Simulate the live system being encrypted by ransomware: only the package and verifier remain.
  const dir = mkdtempSync(path.join(os.tmpdir(), "pf-drill-"));
  const pfr = path.join(dir, "backup.pfr");
  const keyFile = path.join(dir, "key.txt");
  writeFileSync(pfr, archive);
  writeFileSync(keyFile, recoveryKey);
  const root = findRepoRoot()!;
  const verifier = path.join(root, "dist/offline-verifier/pfr-verify.mjs");
  if (!existsSync(verifier)) execFileSync("node", [path.join(root, "lib/fortress-core/build-verifier.mjs")], { stdio: "ignore" });
  const out = path.join(dir, "restored");
  const run = spawnSync("node", [verifier, pfr, "--trust-key", trust, "--recovery-key-file", keyFile, "--out", out], {
    env: { PATH: process.env.PATH ?? "" }, cwd: dir, encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /RESULT: VERIFIED/);
  const files = readdirSync(out);
  const restored = files.filter((f) => f.startsWith("backup-")).map((f) => readFileSync(path.join(out, f), "utf8"));
  assert.deepEqual(restored, [canonicalize(data)]);

  // A tampered package and a wrong key are both rejected.
  const bad = Buffer.from(archive);
  const at = bad.indexOf(Buffer.from("BACKUP_CREATED"));
  bad[at] = "X".charCodeAt(0);
  writeFileSync(path.join(dir, "bad.pfr"), bad);
  assert.equal(spawnSync("node", [verifier, path.join(dir, "bad.pfr"), "--trust-key", trust], { encoding: "utf8" }).status, 1);
  writeFileSync(keyFile, Buffer.alloc(32, 1).toString("base64"));
  const wrong = spawnSync("node", [verifier, pfr, "--trust-key", trust, "--recovery-key-file", keyFile, "--out", path.join(dir, "w")], { encoding: "utf8" });
  assert.equal(wrong.status, 3);
});

test("[G11] a bad backup is rejected at restore and the source is never overwritten", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_g11");
  const bk = await backup(c, datasetId, { good: true });
  const plan = await c.post("/v1/restores/plan", { backupId: bk.id, target: "copy-a", idempotencyKey: ik() });
  expectStatus(plan, 200);
  assert.equal(plan.body.dryRun, true);
  expectStatus(await c.post("/v1/restores/confirm", { planId: plan.body.id, confirmation: "RESTORE wrong", idempotencyKey: ik() }), 403, "FORBIDDEN");
  assert.ok((await eventTypes(tenantId)).includes("RESTORE_CONFIRMATION_FAILED"));

  const row = await pool.query<{ ciphertext: string }>("SELECT ciphertext FROM fortress_backups WHERE id = $1", [bk.id]);
  const flipped = Buffer.from(row.rows[0]!.ciphertext, "base64");
  flipped[0] = flipped[0]! ^ 0xff;
  await pool.query("UPDATE fortress_backups SET ciphertext = $2 WHERE id = $1", [bk.id, flipped.toString("base64")]);
  const plan2 = await c.post("/v1/restores/plan", { backupId: bk.id, target: "copy-b", idempotencyKey: ik() });
  expectStatus(await c.post("/v1/restores/confirm", { planId: plan2.body.id, confirmation: plan2.body.confirmation, idempotencyKey: ik() }), 409, "INTEGRITY_FAILURE");
  const stages = await pool.query("SELECT 1 FROM fortress_stages WHERE tenant_id = $1", [tenantId]);
  assert.equal(stages.rows.length, 0);
  expectStatus(await c.post("/v1/verify"), 409, "INTEGRITY_FAILURE");
  const cond = await pool.query<{ code: string }>("SELECT code FROM fortress_integrity_conditions WHERE tenant_id = $1", [tenantId]);
  assert.ok(cond.rows.some((r) => r.code === "CIPHERTEXT_AUTH_FAILED"));
});

test("[G12] secret scan: no recovery key, code, credential, KEK or plaintext is stored or archived", async () => {
  const { c, tenantId, recoveryKey, datasetId } = await setupOwner("user_g12");
  const marker = `PLAINTEXT-MARKER-${Date.now()}`;
  await backup(c, datasetId, { marker });
  const codes = (await c.post("/v1/recovery/codes", { idempotencyKey: ik() })).body.codes as string[];
  await grant(c, "evidence_storage");
  await grant(c, "juscr_ingest");
  const evMarker = `EVIDENCE-MARKER-${Date.now()}`;
  await c.post("/v1/evidence", { label: "x", content: evMarker, idempotencyKey: ik() });
  const tokenKey = ik();
  const cred = await c.post("/v1/credentials", { name: "t", datasetId, kind: "ingest", expiresInMinutes: 60, idempotencyKey: tokenKey });
  const replay = await c.post("/v1/credentials", { name: "t", datasetId, kind: "ingest", expiresInMinutes: 60, idempotencyKey: tokenKey });
  assert.equal(replay.body.token, null, "a replayed response never re-reveals the token");
  const emergency = await as("user_g12", "s2").post("/v1/recovery/emergency", { recoveryCode: codes[3], idempotencyKey: ik() });
  expectStatus(emergency, 200);
  await exportOutbox();

  const tables = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'fortress\\_%'");
  let dump = "";
  for (const t of tables.rows) {
    const rows = await pool.query(`SELECT row_to_json(x)::text AS j FROM "${t.tablename}" x`);
    dump += rows.rows.map((r: { j: string }) => r.j).join("\n");
  }
  for (const f of readdirSync(process.env.FORTRESS_ARCHIVE_DIR!)) dump += readFileSync(path.join(process.env.FORTRESS_ARCHIVE_DIR!, f), "utf8");
  const kek = process.env.BACKUP_ENCRYPTION_KEY!;
  const secrets: Record<string, string> = {
    recoveryKey, recoveryKeyHex: Buffer.from(recoveryKey, "base64").toString("hex"),
    newRecoveryKey: emergency.body.recoveryKey, kek, token: cred.body.token, marker, evMarker,
  };
  codes.forEach((code, i) => { secrets[`code${i}`] = code; secrets[`codeRaw${i}`] = code.replace(/-/g, ""); });
  (emergency.body.newCodes as string[]).forEach((code, i) => { secrets[`newCode${i}`] = code; });
  for (const [name, value] of Object.entries(secrets)) {
    assert.ok(value && value.length >= 10, `secret ${name} is set`);
    assert.equal(dump.includes(value), false, `${name} found at rest`);
  }
  assert.ok(dump.length > 1000 && dump.includes(tenantId));
});

test("[G14] safe mode: suppressed notices, no notice to removed contacts, no tracking columns", async () => {
  const { c } = await setupOwner("user_g14");
  await grant(c, "recovery_contacts");
  const contact = await c.post("/v1/recovery/contacts", { label: "Sam", contactUserId: "user_g14_contact", idempotencyKey: ik() });
  expectStatus(contact, 200);
  expectStatus(await c.put("/v1/safety", { safeMode: true, locale: "es", notificationMode: "in_app", idempotencyKey: ik() }), 200);
  const before = (await c.get("/v1/notifications")).body.length;
  await c.post("/v1/recovery/codes", { idempotencyKey: ik() });
  assert.equal((await c.get("/v1/notifications")).body.length, before, "safe mode hides new notices");
  expectStatus(await c.post(`/v1/recovery/contacts/${contact.body.id}/remove`, { idempotencyKey: ik() }), 200);
  const toContact = await pool.query("SELECT 1 FROM fortress_notifications WHERE recipient_user_id = 'user_g14_contact'");
  assert.equal(toContact.rows.length, 0, "removed contact is never told");
  expectStatus(await c.put("/v1/safety", { safeMode: false, locale: "es", notificationMode: "in_app", idempotencyKey: ik() }), 200);
  await c.post("/v1/recovery/codes", { idempotencyKey: ik() });
  const list = (await c.get("/v1/notifications")).body as Array<{ text: string }>;
  assert.ok(list.length > before);
  assert.match(list[0]!.text, /c[oó]digos/i, "rendered in the chosen language");
  const cols = await pool.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'fortress\\_%' AND column_name ~ '(^ip|_ip$|ip_addr|location|geo|user_agent|device|latitude|longitude)'",
  );
  assert.deepEqual(cols.rows, [], "no tracking columns exist");
});

test("[G09] provider failure is reported, never claimed as success; the local block holds and a retry finishes it", async () => {
  await setupOwner("user_g09b");
  addProviderSession("user_g09b", "sess_a", Date.now() - 120_000);
  addProviderSession("user_g09b", "sess_b", Date.now() - 120_000);
  const owner = as("user_g09b", "sess_owner");
  addProviderSession("user_g09b", "sess_owner", Date.now() - 1_000);
  providerFault.list = true;
  expectStatus(await owner.post("/v1/security/sessions/revoke", { idempotencyKey: ik() }), 502, "PROVIDER_REVOCATION_FAILED");
  // Refreshed tokens (new iat) from sessions created before the cutoff are refused.
  const fresh = Math.floor(Date.now() / 1000) + 5;
  expectStatus(await as("user_g09b", "sess_a", fresh).get("/v1/me"), 401, "SESSION_REVOKED");
  expectStatus(await owner.get("/v1/me"), 200);
  assert.equal(providerRevocations.length, 0);
  // Listing works again but revoking fails: ids are recorded and blocked by id.
  providerFault.list = false;
  providerFault.revoke = true;
  await retryPendingRevocations(testRevoker);
  const stored = await pool.query<{ session_id: string; provider_revoked: boolean }>(
    "SELECT session_id, provider_revoked FROM fortress_revoked_sessions WHERE user_id = 'user_g09b' ORDER BY session_id",
  );
  assert.deepEqual(stored.rows.map((r) => [r.session_id, r.provider_revoked]), [["sess_a", false], ["sess_b", false]]);
  expectStatus(await as("user_g09b", "sess_b", fresh).get("/v1/me"), 401, "SESSION_REVOKED");
  providerFault.revoke = false;
  await retryPendingRevocations(testRevoker);
  assert.deepEqual([...providerRevocations].sort(), ["sess_a", "sess_b"]);
  assert.deepEqual(providerSessions.get("user_g09b")!.map((s) => s.id), ["sess_owner"]);
});

test("[G06] one-time secrets are never re-issued or replayed for the same idempotency key", async () => {
  const { c, tenantId, recoveryKey } = await setupOwner("user_g06b");
  const key = ik("codes");
  const first = await c.post("/v1/recovery/codes", { idempotencyKey: key });
  expectStatus(first, 200);
  expectStatus(await c.post("/v1/recovery/codes", { idempotencyKey: key }), 409, "SECRET_ALREADY_ISSUED");
  const batches = await pool.query("SELECT DISTINCT batch_id FROM fortress_recovery_codes WHERE tenant_id = $1", [tenantId]);
  assert.equal(batches.rows.length, 1, "the replay did not generate another batch");

  const rk = ik("rotate");
  const rot = await c.post("/v1/recovery/rotate", { currentRecoveryKey: recoveryKey, idempotencyKey: rk });
  expectStatus(rot, 200);
  const replay = await c.post("/v1/recovery/rotate", { currentRecoveryKey: recoveryKey, idempotencyKey: rk });
  expectStatus(replay, 409, "SECRET_ALREADY_ISSUED");
  assert.equal(JSON.stringify(replay.body).includes(rot.body.recoveryKey), false);
  const status = await c.get("/v1/recovery/status");
  assert.equal(status.body.pendingMode, "rotation");
  const issued = await pool.query("SELECT 1 FROM fortress_events WHERE tenant_id = $1 AND event_type = 'RECOVERY_ROTATION_ISSUED'", [tenantId]);
  assert.equal(issued.rows.length, 1);
  expectStatus(await c.post("/v1/recovery/rotate/confirm", { recoveryKey: rot.body.recoveryKey, idempotencyKey: ik() }), 200);
});

test("[G02][G03] until startup verification succeeds, readiness is NOT_READY and writes are refused", async () => {
  const { c, datasetId } = await setupOwner("user_boot");
  setStartupState("failed", "simulated");
  try {
    const ready = await anon().get("/readyz");
    expectStatus(ready, 503);
    assert.equal(ready.body.status, "NOT_READY");
    assert.ok(ready.body.checks.some((x: { name: string; ok: boolean }) => x.name === "startup_verification" && !x.ok));
    expectStatus(await c.post("/v1/backups", { datasetId, data: { a: 1 }, idempotencyKey: ik() }), 503, "NOT_READY");
    setStartupState("pending");
    assert.equal((await anon().get("/readyz")).body.status, "NOT_READY");
  } finally {
    assert.ok(await startupVerification());
  }
  assert.equal((await anon().get("/readyz")).body.status, "ready");
  await backup(c, datasetId, { a: 2 });
});

test("[G05] verification running alongside concurrent commits never reports false tampering", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_g05b");
  const writes = Array.from({ length: 12 }, (_, i) => c.post("/v1/backups", { datasetId, data: { i }, idempotencyKey: ik() }));
  const checks = Array.from({ length: 12 }, () => c.post("/v1/verify"));
  const results = await Promise.all([...writes, ...checks]);
  for (const r of results) expectStatus(r, 200);
  const open = await pool.query("SELECT code FROM fortress_integrity_conditions WHERE tenant_id = $1", [tenantId]);
  assert.equal(open.rows.length, 0);
});

test("[G03] resolve clears a condition only when its own check passes", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_resolve");
  const bk = await backup(c, datasetId, { secret: "x" });
  const row = await pool.query<{ tag: string }>("SELECT tag FROM fortress_backups WHERE id = $1", [bk.id]);
  const original = row.rows[0]!.tag;
  // Corrupt the authentication tag: verify flags CIPHERTEXT_AUTH_FAILED.
  await pool.query("UPDATE fortress_backups SET tag = $2 WHERE id = $1", [bk.id, Buffer.alloc(16, 7).toString("base64")]);
  expectStatus(await c.post("/v1/verify"), 409, "INTEGRITY_FAILURE");
  const open1 = await pool.query<{ code: string }>("SELECT code FROM fortress_integrity_conditions WHERE tenant_id = $1 AND resolved_at IS NULL", [tenantId]);
  assert.deepEqual(open1.rows.map((r) => r.code), ["CIPHERTEXT_AUTH_FAILED"]);
  // The ledger is intact, but that is not enough: the item still fails.
  const refused = await c.post("/v1/integrity/resolve", { idempotencyKey: ik() });
  expectStatus(refused, 409, "INTEGRITY_FAILURE");
  assert.match(refused.body.error, /CIPHERTEXT_AUTH_FAILED/);
  await pool.query("UPDATE fortress_backups SET tag = $2 WHERE id = $1", [bk.id, original]);
  expectStatus(await c.post("/v1/integrity/resolve", { idempotencyKey: ik() }), 200);
  assert.equal((await anon().get("/readyz")).body.status, "ready");
});
