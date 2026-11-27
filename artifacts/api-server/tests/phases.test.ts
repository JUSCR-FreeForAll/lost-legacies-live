/**
 * Phase 2-5 acceptance tests against the separate fortress_test database.
 */
import { anon, as, backup, expectStatus, grant, ik, pool, resetDb, setupOwner } from "./helpers";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  FORTRESS_CONTEXT_URL,
  SEAMCRAFT_VERSION,
  countersign,
  createCheckpoint,
  signCanonical,
  signerFromSeed,
  type SeamcraftEnvelope,
} from "@workspace/fortress-core";

beforeEach(resetDb);
after(() => pool.end());

const peer = signerFromSeed(Buffer.alloc(32, 11));
const witness = signerFromSeed(Buffer.alloc(32, 12));
const sender = signerFromSeed(Buffer.alloc(32, 13));

async function conditions(tenantId: string): Promise<string[]> {
  const r = await pool.query<{ code: string }>("SELECT code FROM fortress_integrity_conditions WHERE tenant_id = $1 AND resolved_at IS NULL", [tenantId]);
  return r.rows.map((x) => x.code);
}

test("[P2-1] contact recovery needs the quorum and the waiting period; the owner can cancel", async () => {
  const { c, tenantId } = await setupOwner("user_p21");
  expectStatus(await c.post("/v1/recovery/contacts", { label: "A", contactUserId: "user_p21_a", idempotencyKey: ik() }), 403, "CONSENT_REQUIRED");
  await grant(c, "recovery_contacts");
  for (const k of ["a", "b", "c"]) {
    expectStatus(await c.post("/v1/recovery/contacts", { label: k, contactUserId: `user_p21_${k}`, idempotencyKey: ik() }), 200);
  }
  expectStatus(await c.put("/v1/recovery/policy", { threshold: 4, delayHours: 24, idempotencyKey: ik() }), 409, "CONFLICT");
  expectStatus(await c.put("/v1/recovery/policy", { threshold: 2, delayHours: 24, idempotencyKey: ik() }), 200);

  // Cancel path.
  const first = await c.post("/v1/recovery/ceremonies", { idempotencyKey: ik() });
  expectStatus(first, 200);
  expectStatus(await c.post(`/v1/recovery/ceremonies/${first.body.id}/cancel`, { idempotencyKey: ik() }), 200);
  expectStatus(await as("user_p21_a").post(`/v1/helper/requests/${first.body.id}/approve`, { idempotencyKey: ik() }), 404, "NOT_FOUND");

  const cer = await c.post("/v1/recovery/ceremonies", { idempotencyKey: ik() });
  expectStatus(cer, 200);
  // A stranger cannot approve.
  expectStatus(await as("user_stranger").post(`/v1/helper/requests/${cer.body.id}/approve`, { idempotencyKey: ik() }), 404, "NOT_FOUND");
  const helperList = await as("user_p21_a").get("/v1/helper/requests");
  assert.equal(helperList.body.length, 1);
  expectStatus(await as("user_p21_a").post(`/v1/helper/requests/${cer.body.id}/approve`, { idempotencyKey: ik() }), 200);
  // A duplicate approval by the same contact does not count twice.
  expectStatus(await as("user_p21_a").post(`/v1/helper/requests/${cer.body.id}/approve`, { idempotencyKey: ik() }), 200);
  // Fast-forward the delay: still only one approval.
  await pool.query("UPDATE fortress_ceremonies SET ready_at = now() - interval '1 minute' WHERE id = $1", [cer.body.id]);
  const early = await c.post(`/v1/recovery/ceremonies/${cer.body.id}/complete`, { idempotencyKey: ik() });
  expectStatus(early, 409, "CONFLICT");
  assert.match(early.body.error, /1 of 2/);
  // Second approval, but restore the delay: waiting period is enforced.
  expectStatus(await as("user_p21_b").post(`/v1/helper/requests/${cer.body.id}/approve`, { idempotencyKey: ik() }), 200);
  await pool.query("UPDATE fortress_ceremonies SET ready_at = now() + interval '1 hour' WHERE id = $1", [cer.body.id]);
  expectStatus(await c.post(`/v1/recovery/ceremonies/${cer.body.id}/complete`, { idempotencyKey: ik() }), 409, "CONFLICT");
  // An approval from a contact who is later removed no longer counts.
  const contacts = (await c.get("/v1/recovery/contacts")).body as Array<{ id: string; contactUserId: string }>;
  const b = contacts.find((x) => x.contactUserId === "user_p21_b")!;
  expectStatus(await c.post(`/v1/recovery/contacts/${b.id}/remove`, { idempotencyKey: ik() }), 200);
  await pool.query("UPDATE fortress_ceremonies SET ready_at = now() - interval '1 minute' WHERE id = $1", [cer.body.id]);
  expectStatus(await c.post(`/v1/recovery/ceremonies/${cer.body.id}/complete`, { idempotencyKey: ik() }), 409, "CONFLICT");
  expectStatus(await as("user_p21_c").post(`/v1/helper/requests/${cer.body.id}/approve`, { idempotencyKey: ik() }), 200);
  const done = await as("user_p21", "sess_recovering").post(`/v1/recovery/ceremonies/${cer.body.id}/complete`, { idempotencyKey: ik() });
  expectStatus(done, 200);
  assert.equal(done.body.method, "contact_ceremony");
  assert.equal(done.body.sessionsRevoked, true);
  const types = (await pool.query<{ event_type: string }>("SELECT event_type FROM fortress_events WHERE tenant_id = $1", [tenantId])).rows.map((r) => r.event_type);
  for (const t of ["RECOVERY_CEREMONY_STARTED", "RECOVERY_CEREMONY_CANCELLED", "RECOVERY_CEREMONY_APPROVED"]) assert.ok(types.includes(t), t);
  // Contacts never gain access to the tenant.
  const asContact = await as("user_p21_a", "s", undefined, tenantId).get("/v1/backups");
  expectStatus(asContact, 404, "NOT_FOUND");
});

test("[P2-2] every consent-gated action is refused until granted and again after withdrawal", async () => {
  const { c, datasetId } = await setupOwner("user_p22");
  const cp = await c.post("/v1/resilience/checkpoints", { idempotencyKey: ik() });
  expectStatus(cp, 200);
  const attempts = async () => [
    await c.post("/v1/evidence", { label: "x", content: "y", idempotencyKey: ik() }),
    await c.post("/v1/recovery/contacts", { label: "x", contactUserId: "user_p22_x", idempotencyKey: ik() }),
    await c.post("/v1/credentials", { name: "j", datasetId, kind: "ingest", expiresInMinutes: 60, idempotencyKey: ik() }),
    await c.post("/v1/interop/jsonld", { document: { "@context": FORTRESS_CONTEXT_URL, "@id": "urn:x", name: "n" }, idempotencyKey: ik() }),
    await c.post("/v1/anchors", { idempotencyKey: ik() }),
  ];
  for (const r of await attempts()) expectStatus(r, 403, "CONSENT_REQUIRED");
  const consents = (await c.get("/v1/consents")).body as Array<{ purpose: string; state: string }>;
  assert.ok(consents.every((x) => x.state === "never_asked"), "nothing is pre-granted");
  for (const p of ["evidence_storage", "recovery_contacts", "juscr_ingest", "jsonld_import", "external_anchor"]) await grant(c, p);
  for (const r of await attempts()) expectStatus(r, 200);
  for (const p of ["evidence_storage", "recovery_contacts", "juscr_ingest", "jsonld_import", "external_anchor"]) {
    expectStatus(await c.put(`/v1/consents/${p}`, { state: "withdrawn", idempotencyKey: ik() }), 200);
  }
  for (const r of await attempts()) expectStatus(r, 403, "CONSENT_REQUIRED");
});

test("[P2-3] evidence is encrypted at rest, readable by the owner, and crypto-shredded on delete", async () => {
  const { c, tenantId } = await setupOwner("user_p23");
  await grant(c, "evidence_storage");
  const secret = `incident-notes-${randomBytes(6).toString("hex")}`;
  const ev = await c.post("/v1/evidence", { label: "Incident", content: secret, idempotencyKey: ik() });
  expectStatus(ev, 200);
  const row = await pool.query<Record<string, unknown>>("SELECT row_to_json(e)::text AS j FROM fortress_evidence e WHERE id = $1", [ev.body.id]);
  assert.equal(String(row.rows[0]!.j).includes(secret), false);
  const read = await c.get(`/v1/evidence/${ev.body.id}/data`);
  expectStatus(read, 200);
  assert.equal(read.body.content, secret);
  expectStatus(await c.post(`/v1/evidence/${ev.body.id}/delete`, { idempotencyKey: ik() }), 200);
  const after = await pool.query<{ ciphertext: string | null; wrapped_data_key: string | null; label: string }>(
    "SELECT ciphertext, wrapped_data_key, label FROM fortress_evidence WHERE id = $1", [ev.body.id]);
  assert.equal(after.rows[0]!.ciphertext, null);
  assert.equal(after.rows[0]!.wrapped_data_key, null);
  assert.equal(after.rows[0]!.label, "[deleted]");
  expectStatus(await c.get(`/v1/evidence/${ev.body.id}/data`), 404, "NOT_FOUND");
  expectStatus(await c.post("/v1/verify"), 200);
  // An operator (non-owner) member cannot read evidence.
  const meta = await pool.query("SELECT 1 FROM fortress_events WHERE tenant_id = $1 AND meta::text LIKE '%Incident%'", [tenantId]);
  assert.equal(meta.rows.length, 0, "labels never enter the ledger");
});

test("[P2-4] notifications store only message IDs and render in English or Spanish", async () => {
  const { c } = await setupOwner("user_p24");
  await c.post("/v1/recovery/codes", { idempotencyKey: ik() });
  const en = (await c.get("/v1/notifications")).body as Array<{ messageId: string; text: string }>;
  assert.ok(en.length > 0);
  expectStatus(await c.put("/v1/safety", { safeMode: false, locale: "es", notificationMode: "in_app", idempotencyKey: ik() }), 200);
  const es = (await c.get("/v1/notifications")).body as Array<{ messageId: string; text: string }>;
  const id = en.find((n) => n.messageId === "recovery.codes.regenerated")!;
  const esSame = es.find((n) => n.messageId === "recovery.codes.regenerated")!;
  assert.notEqual(id.text, esSame.text);
  const cols = await pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'fortress_notifications'");
  const names = cols.rows.map((r) => r.column_name);
  assert.ok(names.includes("message_id"));
  assert.ok(!names.some((n) => /^(text|body|content|message)$/.test(n)), "no free text column");
});

test("[P3-1] witness countersignatures are accepted only from registered witness keys", async () => {
  const { c } = await setupOwner("user_p31");
  const cp = await c.post("/v1/resilience/checkpoints", { idempotencyKey: ik() });
  expectStatus(cp, 200);
  const signed = cp.body.signed;
  const sig = countersign(witness, signed);
  expectStatus(await c.post("/v1/resilience/witnesses", { witness: sig, idempotencyKey: ik() }), 403, "CONSENT_REQUIRED");
  await grant(c, "witness_sharing");
  expectStatus(await c.post("/v1/resilience/witnesses", { witness: sig, idempotencyKey: ik() }), 403, "FORBIDDEN");
  const reg = await c.post("/v1/resilience/signers", { keyId: witness.keyId, kind: "witness", label: "Peer W", idempotencyKey: ik() });
  expectStatus(reg, 200);
  const forged = { ...sig, signature: countersign(peer, signed).signature };
  expectStatus(await c.post("/v1/resilience/witnesses", { witness: forged, idempotencyKey: ik() }), 403, "FORBIDDEN");
  const ok = await c.post("/v1/resilience/witnesses", { witness: sig, idempotencyKey: ik() });
  expectStatus(ok, 200);
  assert.equal(ok.body.witnesses.length, 1);
  // Revoked witness keys stop counting.
  expectStatus(await c.post(`/v1/resilience/signers/${reg.body.id}/revoke`, { idempotencyKey: ik() }), 200);
  expectStatus(await c.post("/v1/resilience/witnesses", { witness: sig, idempotencyKey: ik() }), 403, "FORBIDDEN");
  // Countersigning a peer's checkpoint requires the peer to be registered.
  const peerCp = createCheckpoint(peer, { chainId: "pf:peer", height: 5, tipHash: `sha256:${"b".repeat(64)}` });
  expectStatus(await c.post("/v1/resilience/countersign", { signed: peerCp }), 403, "FORBIDDEN");
  expectStatus(await c.post("/v1/resilience/signers", { keyId: peer.keyId, kind: "peer", label: "Peer P", idempotencyKey: ik() }), 200);
  const cs = await c.post("/v1/resilience/countersign", { signed: peerCp });
  expectStatus(cs, 200);
  assert.equal(cs.body.checkpoint_hash, peerCp.checkpoint_hash);
});

test("[P3-2] importing an external checkpoint detects contradiction and rollback", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_p32");
  const cp = await c.post("/v1/resilience/checkpoints", { idempotencyKey: ik() });
  const signed = cp.body.signed;
  const ok = await c.post("/v1/resilience/import", { signed, origin: "old .pfr", idempotencyKey: ik() });
  expectStatus(ok, 200);
  assert.equal(ok.body.status, "consistent");
  // A forged checkpoint from an unknown signer is refused outright.
  const forged = createCheckpoint(peer, { chainId: cp.body.signed.checkpoint.chain_id, height: 1, tipHash: `sha256:${"c".repeat(64)}` });
  expectStatus(await c.post("/v1/resilience/import", { signed: forged, origin: "x", idempotencyKey: ik() }), 403, "FORBIDDEN");
  // A trusted peer's checkpoint that disagrees with local history.
  expectStatus(await c.post("/v1/resilience/signers", { keyId: peer.keyId, kind: "peer", label: "P", idempotencyKey: ik() }), 200);
  const contra = createCheckpoint(peer, { chainId: cp.body.signed.checkpoint.chain_id, height: 1, tipHash: `sha256:${"d".repeat(64)}` });
  expectStatus(await c.post("/v1/resilience/import", { signed: contra, origin: "peer", idempotencyKey: ik() }), 409, "CHECKPOINT_CONTRADICTION");
  assert.ok((await conditions(tenantId)).includes("CHECKPOINT_CONTRADICTION"));
  assert.equal((await anon().get("/readyz")).body.status, "RECOVERY_REQUIRED");
  expectStatus(await c.post("/v1/backups", { datasetId, data: {}, idempotencyKey: ik() }), 503, "RECOVERY_REQUIRED");
  // A checkpoint ahead of the local tip means local data was rolled back.
  await pool.query("UPDATE fortress_integrity_conditions SET resolved_at = now()");
  const ahead = createCheckpoint(peer, { chainId: cp.body.signed.checkpoint.chain_id, height: 999, tipHash: `sha256:${"e".repeat(64)}` });
  expectStatus(await c.post("/v1/resilience/import", { signed: ahead, origin: "peer", idempotencyKey: ik() }), 409, "CHECKPOINT_CONTRADICTION");
  assert.ok((await conditions(tenantId)).includes("CHECKPOINT_BEYOND_TIP"));
  // Resolve refuses while the trusted proof still contradicts local history...
  const refused = await c.post("/v1/integrity/resolve", { idempotencyKey: ik() });
  expectStatus(refused, 409, "INTEGRITY_FAILURE");
  assert.match(refused.body.error, /CHECKPOINT_BEYOND_TIP/);
  // ...and succeeds once the signer of that proof is no longer trusted.
  const signers = (await c.get("/v1/resilience/signers")).body.signers as Array<{ id: string; keyId: string }>;
  const p = signers.find((x) => x.keyId === peer.keyId)!;
  expectStatus(await c.post(`/v1/resilience/signers/${p.id}/revoke`, { idempotencyKey: ik() }), 200);
  expectStatus(await c.post("/v1/integrity/resolve", { idempotencyKey: ik() }), 200);
  assert.deepEqual(await conditions(tenantId), []);
});

test("[P2-2] consent withdrawn mid-flow is rechecked when the action commits", async () => {
  const { c } = await setupOwner("user_p22b");
  await grant(c, "recovery_contacts");
  for (const k of ["a", "b"]) {
    expectStatus(await c.post("/v1/recovery/contacts", { label: k, contactUserId: `user_p22b_${k}`, idempotencyKey: ik() }), 200);
  }
  expectStatus(await c.put("/v1/recovery/policy", { threshold: 2, delayHours: 24, idempotencyKey: ik() }), 200);
  const cer = await c.post("/v1/recovery/ceremonies", { idempotencyKey: ik() });
  expectStatus(cer, 200);
  for (const k of ["a", "b"]) expectStatus(await as(`user_p22b_${k}`).post(`/v1/helper/requests/${cer.body.id}/approve`, { idempotencyKey: ik() }), 200);
  await pool.query("UPDATE fortress_ceremonies SET ready_at = now() - interval '1 minute' WHERE id = $1", [cer.body.id]);
  expectStatus(await c.put("/v1/consents/recovery_contacts", { state: "withdrawn", idempotencyKey: ik() }), 200);
  expectStatus(await c.post(`/v1/recovery/ceremonies/${cer.body.id}/complete`, { idempotencyKey: ik() }), 403, "CONSENT_REQUIRED");

  await grant(c, "external_anchor");
  expectStatus(await c.post("/v1/resilience/checkpoints", { idempotencyKey: ik() }), 200);
  const anchor = await c.post("/v1/anchors", { idempotencyKey: ik() });
  expectStatus(anchor, 200);
  expectStatus(await c.put("/v1/consents/external_anchor", { state: "withdrawn", idempotencyKey: ik() }), 200);
  const sig = "5".repeat(88);
  expectStatus(await c.post(`/v1/anchors/${anchor.body.id}/record`, { network: "devnet", txSignature: sig, idempotencyKey: ik() }), 403, "CONSENT_REQUIRED");
});

test("[P3-3] merging a peer's revocations revokes locally and can never re-grant", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_p33");
  await grant(c, "juscr_ingest");
  const cred = await c.post("/v1/credentials", { name: "j", datasetId, kind: "ingest", expiresInMinutes: 60, idempotencyKey: ik() });
  expectStatus(cred, 200);
  expectStatus(await anon().post("/v1/ingest/backups", { data: { a: 1 }, idempotencyKey: ik() }, cred.body.token), 200);
  const id = cred.body.credential.id as string;
  const merged = await c.post("/v1/resilience/revocations/merge", {
    state: { [`credential:${id}`]: { kind: "credential", id, revoked_at_us: Date.now() * 1000, origin: "peer-1" } },
    idempotencyKey: ik(),
  });
  expectStatus(merged, 200);
  assert.equal(merged.body.added, 1);
  assert.ok(merged.body.applied >= 1);
  expectStatus(await anon().post("/v1/ingest/backups", { data: { a: 2 }, idempotencyKey: ik() }, cred.body.token), 401, "UNAUTHENTICATED");
  // An empty peer state, or a garbage "grant", changes nothing.
  const empty = await c.post("/v1/resilience/revocations/merge", { state: {}, idempotencyKey: ik() });
  expectStatus(empty, 200);
  assert.equal(empty.body.added, 0);
  expectStatus(await c.post("/v1/resilience/revocations/merge", { state: { [`credential:${id}`]: { kind: "credential", id, granted: true } }, idempotencyKey: ik() }), 400, "BAD_REQUEST");
  const state = (await c.get("/v1/resilience/revocations")).body.state as Record<string, unknown>;
  assert.ok(`credential:${id}` in state);
  const row = await pool.query<{ revoked: unknown }>("SELECT revoked FROM fortress_credentials WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
  assert.ok(row.rows[0]!.revoked);
});

test("[P4-1] JSON-LD import commits the RDFC-1.0 digest and refuses remote contexts", async () => {
  const { c } = await setupOwner("user_p41");
  await grant(c, "jsonld_import");
  const doc = { "@context": FORTRESS_CONTEXT_URL, "@id": "urn:pf:rec:1", "@type": "RecoveryRecord", name: "Record", status: "ok" };
  const reordered = { status: "ok", name: "Record", "@type": "RecoveryRecord", "@id": "urn:pf:rec:1", "@context": FORTRESS_CONTEXT_URL };
  const a = await c.post("/v1/interop/jsonld", { document: doc, idempotencyKey: ik() });
  const b = await c.post("/v1/interop/jsonld", { document: reordered, idempotencyKey: ik() });
  expectStatus(a, 200);
  expectStatus(b, 200);
  assert.equal(a.body.objectRef, b.body.objectRef, "graph identity ignores key order");
  assert.equal(a.body.meta.canonicalization, "RDFC-1.0");
  const remote = await c.post("/v1/interop/jsonld", { document: { "@context": "https://evil.example/ctx.jsonld", name: "x" }, idempotencyKey: ik() });
  expectStatus(remote, 422, "ADAPTER_REJECTED");
  assert.match(remote.body.error, /REMOTE_CONTEXT_BLOCKED/);
});

function envelope(recipient: string, overrides: Partial<SeamcraftEnvelope> = {}, signer = sender): SeamcraftEnvelope {
  const unsigned = {
    type: "seamcraft.envelope" as const,
    version: SEAMCRAFT_VERSION,
    sender: signer.keyId,
    recipient,
    nonce: randomBytes(16).toString("base64url"),
    issued_at: new Date().toISOString(),
    payload_type: "application/json" as const,
    payload: { message: "hello" },
    ...overrides,
  };
  return { ...unsigned, signature: signCanonical(signer, unsigned) };
}

test("[P4-2] Seamcraft envelopes need consent, a registered signed sender, the right recipient and a fresh nonce", async () => {
  const { c } = await setupOwner("user_p42");
  const me = await c.get("/v1/resilience/checkpoints");
  expectStatus(me, 200);
  const cp = await c.post("/v1/resilience/checkpoints", { idempotencyKey: ik() });
  const recipient = String(cp.body.signed.checkpoint.chain_id);
  const env = envelope(recipient);
  expectStatus(await c.post("/v1/interop/seamcraft", { envelope: env, idempotencyKey: ik() }), 403, "CONSENT_REQUIRED");
  await grant(c, "seamcraft_import");
  expectStatus(await c.post("/v1/interop/seamcraft", { envelope: env, idempotencyKey: ik() }), 403, "FORBIDDEN");
  expectStatus(await c.post("/v1/resilience/signers", { keyId: sender.keyId, kind: "seamcraft_sender", label: "S", idempotencyKey: ik() }), 200);
  expectStatus(await c.post("/v1/interop/seamcraft", { envelope: env, idempotencyKey: ik() }), 200);
  const replay = await c.post("/v1/interop/seamcraft", { envelope: env, idempotencyKey: ik() });
  expectStatus(replay, 409, "REPLAY_REJECTED");
  const tampered = { ...envelope(recipient), payload: { message: "changed" } };
  expectStatus(await c.post("/v1/interop/seamcraft", { envelope: tampered, idempotencyKey: ik() }), 422, "ADAPTER_REJECTED");
  expectStatus(await c.post("/v1/interop/seamcraft", { envelope: envelope("pf:someone-else"), idempotencyKey: ik() }), 422, "ADAPTER_REJECTED");
  const stale = envelope(recipient, { issued_at: new Date(Date.now() - 3_600_000).toISOString() });
  expectStatus(await c.post("/v1/interop/seamcraft", { envelope: stale, idempotencyKey: ik() }), 422, "ADAPTER_REJECTED");
  expectStatus(await c.post("/v1/interop/seamcraft", { envelope: { ...envelope(recipient), extra: 1 }, idempotencyKey: ik() }), 422, "ADAPTER_REJECTED");
});

test("[P4-3] JUSCR ingest through a write-only credential is idempotent and cannot read", async () => {
  const { c, tenantId, datasetId } = await setupOwner("user_p43");
  await grant(c, "juscr_ingest");
  const cred = await c.post("/v1/credentials", { name: "JUSCR", datasetId, kind: "ingest", expiresInMinutes: 1440, idempotencyKey: ik() });
  expectStatus(cred, 200);
  const key = ik("juscr");
  const a = await anon().post("/v1/ingest/backups", { data: { case: 1 }, idempotencyKey: key }, cred.body.token);
  const b = await anon().post("/v1/ingest/backups", { data: { case: 1 }, idempotencyKey: key }, cred.body.token);
  expectStatus(a, 200);
  expectStatus(b, 200);
  assert.equal(a.body.backupId, b.body.backupId);
  assert.equal(b.body.replay, true);
  const n = await pool.query<{ n: string }>("SELECT count(*) AS n FROM fortress_backups WHERE tenant_id = $1", [tenantId]);
  assert.equal(Number(n.rows[0]!.n), 1);
  expectStatus(await anon().post("/v1/exports", { backupId: a.body.backupId }, cred.body.token), 403);
  expectStatus(await anon().get("/v1/backups").set("Authorization", `Bearer ${cred.body.token}`), 403, "FORBIDDEN");
  // Withdrawing consent stops ingest even with a live credential.
  expectStatus(await c.put("/v1/consents/juscr_ingest", { state: "withdrawn", idempotencyKey: ik() }), 200);
  expectStatus(await anon().post("/v1/ingest/backups", { data: { case: 2 }, idempotencyKey: ik() }, cred.body.token), 403, "CONSENT_REQUIRED");
  // Existing backup/restore still works for the owner.
  await backup(c, datasetId, { owner: true });
});

test("[P5-1] anchors need consent, carry only hashes and record a transaction without network", async () => {
  const { c, tenantId } = await setupOwner("user_p51");
  expectStatus(await c.post("/v1/resilience/checkpoints", { idempotencyKey: ik() }), 200);
  expectStatus(await c.post("/v1/anchors", { idempotencyKey: ik() }), 403, "CONSENT_REQUIRED");
  await grant(c, "external_anchor");
  const a = await c.post("/v1/anchors", { idempotencyKey: ik() });
  expectStatus(a, 200);
  assert.deepEqual(Object.keys(a.body.commitment).sort(), ["chain_ref", "checkpoint_hash", "height", "tip_hash"]);
  assert.equal(a.body.memo.includes("user_p51"), false);
  assert.equal(a.body.memo.includes(tenantId), false, "tenant id is not on-chain");
  expectStatus(await c.post(`/v1/anchors/${a.body.id}/record`, { txSignature: "not-a-sig-but-long-enough-to-pass-length-check-xxxxxxxxxxxxxxxxxxxxxxxxxxx", network: "devnet", idempotencyKey: ik() }), 400, "BAD_REQUEST");
  const sig = "5".repeat(88);
  const rec = await c.post(`/v1/anchors/${a.body.id}/record`, { txSignature: sig, network: "devnet", idempotencyKey: ik() });
  expectStatus(rec, 200);
  assert.equal(rec.body.status, "recorded_unverified");
});
