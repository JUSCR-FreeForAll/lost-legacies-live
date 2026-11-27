/**
 * Framework-free core checks (no database, no network).
 */
import "./env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  AdapterError,
  FORTRESS_CONTEXT_URL,
  LOCALES,
  MESSAGES,
  addTombstone,
  anchorMemo,
  assertAnchorIsNonPersonal,
  buildAnchorCommitment,
  buildManifest,
  canonicalize,
  canonicalizeJsonLd,
  catalogProblems,
  createCheckpoint,
  genesisBlock,
  isRevoked,
  merge,
  nextBlock,
  renderMessage,
  signerFromSeed,
  verifyChain,
  type RevocationState,
} from "@workspace/fortress-core";

const signer = signerFromSeed(Buffer.alloc(32, 7));

test("[G01] genesis is a pure function of the manifest (same input, same block)", () => {
  const m = buildManifest({ installationName: "fortress-test", trustKey: signer.keyId, scope: "00000000-0000-4000-8000-000000000001" });
  const a = genesisBlock(m);
  const b = genesisBlock(structuredClone(m));
  assert.deepEqual(a, b);
  assert.equal(a.idx, 0);
  assert.equal(a.occurred_at_us, 0);
  assert.match(a.hash, /^sha256:[0-9a-f]{64}$/);
  const other = genesisBlock(buildManifest({ installationName: "other", trustKey: signer.keyId }));
  assert.notEqual(other.hash, a.hash);
});

test("[G01] canonical JSON is order-independent and rejects floats that are not finite", () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, "x"] }), canonicalize({ a: [true, null, "x"], b: 1 }));
  assert.throws(() => canonicalize({ x: Number.NaN }));
  assert.throws(() => canonicalize({ x: undefined }));
});

test("[G03] a modified block breaks chain verification", () => {
  const m = buildManifest({ installationName: "fortress-test", trustKey: signer.keyId });
  const g = genesisBlock(m);
  const b1 = nextBlock(g, { eventType: "X", actorId: "u", meta: { n: 1 }, idempotencyKey: null });
  const b2 = nextBlock(b1, { eventType: "Y", actorId: "u", meta: { n: 2 }, idempotencyKey: null });
  assert.equal(verifyChain(m, [g, b1, b2]).height, 2);
  const tampered = { ...b1, meta: { n: 999 } };
  assert.throws(() => verifyChain(m, [g, tampered, b2]));
});

test("[G03] index gaps, predecessor mismatches and unsupported canonicalization versions are rejected", () => {
  const m = buildManifest({ installationName: "fortress-test", trustKey: signer.keyId });
  const g = genesisBlock(m);
  const b1 = nextBlock(g, { eventType: "X", actorId: "u", meta: {}, idempotencyKey: null });
  const b2 = nextBlock(b1, { eventType: "Y", actorId: "u", meta: {}, idempotencyKey: null });
  assert.throws(() => verifyChain(m, [g, b2]), /INDEX|PREV|HASH/);
  const wrongPrev = nextBlock({ idx: 1, hash: g.hash }, { eventType: "Y", actorId: "u", meta: {}, idempotencyKey: null });
  assert.throws(() => verifyChain(m, [g, b1, wrongPrev]));
  assert.throws(() => verifyChain({ ...m, canonicalization: "jcs-v0" } as typeof m, [g, b1]));
  assert.throws(() => verifyChain(m, [g, { ...b1, v: 2 } as typeof b1]));
});

test("[G04] a checkpoint over the original chain rejects a rewritten chain", () => {
  const m = buildManifest({ installationName: "fortress-test", trustKey: signer.keyId });
  const g = genesisBlock(m);
  const b1 = nextBlock(g, { eventType: "X", actorId: "u", meta: {}, idempotencyKey: null });
  const cp = createCheckpoint(signer, { chainId: m.chain_id, height: 1, tipHash: b1.hash });
  // Attacker rebuilds a fully self-consistent chain with different content.
  const forged = nextBlock(g, { eventType: "X", actorId: "attacker", meta: {}, idempotencyKey: null });
  assert.throws(() => verifyChain(m, [g, forged], [cp.checkpoint]));
  assert.equal(verifyChain(m, [g, b1], [cp.checkpoint]).height, 1);
});

test("[P2-4] English and Spanish catalogs have the same IDs and placeholders", () => {
  assert.deepEqual(catalogProblems(), []);
  assert.deepEqual([...LOCALES], ["en", "es"]);
  for (const id of Object.keys(MESSAGES) as Array<keyof typeof MESSAGES>) {
    assert.notEqual(renderMessage(id, "en", { remaining: 1, count: 1, ready_at: "t", active: 1, fingerprint: "f", purpose: "p", state: "s", code: "c" }), "");
  }
  assert.notEqual(renderMessage("evidence.stored", "es"), renderMessage("evidence.stored", "en"));
});

test("[P3-3] revocation CRDT merge is commutative, idempotent and never un-revokes", () => {
  const a: RevocationState = addTombstone({}, { kind: "credential", id: "c1", revoked_at_us: 10, origin: "a" });
  const b: RevocationState = addTombstone({}, { kind: "credential", id: "c1", revoked_at_us: 5, origin: "b" });
  const c: RevocationState = addTombstone({}, { kind: "consent", id: "witness_sharing", revoked_at_us: 7, origin: "c" });
  assert.deepEqual(merge(a, b), merge(b, a));
  assert.deepEqual(merge(merge(a, b), c), merge(a, merge(b, c)));
  assert.deepEqual(merge(a, a), a);
  const merged = merge(a, {});
  assert.ok(isRevoked(merged, "credential", "c1"));
  assert.ok(isRevoked(merge({}, a), "credential", "c1"), "empty peer state cannot remove a revocation");
});

test("[P4-1] JSON-LD is canonicalized with RDFC-1.0 independent of key order", async () => {
  const doc1 = { "@context": FORTRESS_CONTEXT_URL, "@id": "urn:x:1", "@type": "RecoveryRecord", name: "A", status: "ok" };
  const doc2 = { status: "ok", name: "A", "@type": "RecoveryRecord", "@id": "urn:x:1", "@context": FORTRESS_CONTEXT_URL };
  const n1 = await canonicalizeJsonLd(doc1);
  assert.equal(n1, await canonicalizeJsonLd(doc2));
  assert.match(n1, /<urn:x:1> <https:\/\/w3id\.org\/phoenix-fortress\/vocab#name> "A" \./);
});

test("[P4-1] remote JSON-LD contexts are never fetched", async () => {
  await assert.rejects(
    canonicalizeJsonLd({ "@context": "https://example.org/remote-context.jsonld", name: "x" }),
    (err: unknown) => err instanceof AdapterError && err.code === "REMOTE_CONTEXT_BLOCKED",
  );
});

test("[P5-1] anchor commitments contain only hashes and a height", () => {
  const m = buildManifest({ installationName: "fortress-test", trustKey: signer.keyId, scope: "00000000-0000-4000-8000-000000000001" });
  const cp = createCheckpoint(signer, { chainId: m.chain_id, height: 3, tipHash: `sha256:${"a".repeat(64)}` });
  const commitment = buildAnchorCommitment(cp);
  assert.deepEqual(Object.keys(commitment).sort(), ["chain_ref", "checkpoint_hash", "height", "tip_hash"]);
  assert.match(anchorMemo(commitment), /^pf-anchor-v1 \{/);
  assert.throws(() => assertAnchorIsNonPersonal({ ...commitment, email: "a@b.c" }));
  assert.throws(() => assertAnchorIsNonPersonal({ ...commitment, chain_ref: "Jane Doe" }));
  assert.equal(anchorMemo(commitment).includes("00000000-0000-4000-8000-000000000001"), false);
});

test("[G12] random 32-byte key material never appears in canonical ledger meta helpers", () => {
  const secret = randomBytes(32).toString("base64");
  const m = buildManifest({ installationName: "fortress-test", trustKey: signer.keyId });
  const g = genesisBlock(m);
  assert.throws(() => nextBlock(g, { eventType: "X", actorId: "u", meta: { recoveryKey: secret }, idempotencyKey: null }));
});
