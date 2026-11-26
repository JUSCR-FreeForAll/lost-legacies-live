import test from "node:test";
import assert from "node:assert/strict";
import { MemoryEventStore } from "../src/index.js";
import { runFinalizedBackfill, reconcileConfirmed } from "../src/recovery.js";

const provenance = { anchorVersion: "1.2.2", parserVersion: "1.2.2", idlVersion: "fixture" };
const history = ["new", "middle", "anchor"];
const makeProvider = () => ({
  async getSignaturesForAddress(_program, { before, limit }, commitment) {
    assert.equal(commitment, "finalized");
    const offset = before ? history.indexOf(before) + 1 : 0;
    return history.slice(offset, offset + limit).map(signature => ({ signature }));
  },
  async getTransaction(signature, { commitment }) {
    assert.equal(commitment, "finalized");
    return { slot: history.indexOf(signature) + 10, meta: { err: null }, signature };
  }
});
const decode = async (_tx) => [{ name: "Outer" }, { name: "InnerCpiFixture" }];

test("backfill processes oldest to newest, retains decoded ordering and persists checkpoint", async () => {
  const store = new MemoryEventStore(), seen = [];
  const options = {
    programId: "program", store, provider: makeProvider(), decodeTransaction: decode,
    onEvent: e => seen.push(e.eventKey), startingSignature: "anchor",
    pageSize: 2, provenance
  };
  const result = await runFinalizedBackfill(options);
  assert.deepEqual(seen, [
    "program:middle:0", "program:middle:1", "program:new:0", "program:new:1"
  ]);
  assert.equal(result.scanned, 2);
  assert.equal(await store.getCheckpoint("solana:program:finalized"), "new");
  assert.equal((await runFinalizedBackfill(options)).scanned, 0);
  assert.equal(seen.length, 4);
});

test("backfill rejects unanchored scans and missing history without moving checkpoint", async () => {
  const store = new MemoryEventStore(), seen = [];
  const config = {
    provider: makeProvider(), programId: "program", store,
    decodeTransaction: decode, onEvent: e => seen.push(e)
  };
  await assert.rejects(runFinalizedBackfill(config), /starting signature/);
  await assert.rejects(runFinalizedBackfill({
    ...config, startingSignature: "nonexistent", pageSize: 2
  }), /checkpoint not found/);
  assert.equal(seen.length, 0);
  assert.equal(await store.getCheckpoint("solana:program:finalized"), null);
});

test("backfill does not acknowledge or advance checkpoint if dispatch fails", async () => {
  const store = new MemoryEventStore();
  let failed = false;
  await assert.rejects(runFinalizedBackfill({
    provider: makeProvider(), programId: "program", store, startingSignature: "anchor",
    decodeTransaction: decode,
    onEvent: () => { if (!failed) { failed = true; throw Error("downstream offline"); } }
  }), /downstream offline/);
  assert.equal(await store.getCheckpoint("solana:program:finalized"), null);
  assert.equal((await store.get("program:middle:0")).status, "failed");
});

test("reconciliation requires proven orphan status and ignores unknown observations", async () => {
  const store = new MemoryEventStore();
  const e = (signature, slot) => ({
    eventKey: `p:${signature}:0`, programId: "p", signature, eventIndex: 0,
    eventName: "Created", data: {}, commitment: "confirmed", slot
  });
  await store.put(e("confirmed", 5));
  await store.put(e("orphan", 5));
  await store.put(e("recent", 50));
  const result = await reconcileConfirmed({
    store, getFinalizedSlot: async () => 40,
    onEvent: async () => {},
    canonicalResolver: async item => item.signature === "confirmed"
      ? { state: "finalized", slot: 5 }
      : { state: "orphaned", evidence: "historical finalized index excludes this signature" }
  });
  assert.deepEqual(result, { finalized: 1, orphaned: 1, unknown: 1 });
  assert.equal((await store.get("p:confirmed:0")).commitment, "finalized");
  assert.equal((await store.get("p:orphan:0")).status, "orphaned");
  assert.equal((await store.get("p:recent:0")).status, "pending");
  await store.put(e("unclear", 4));
  await assert.rejects(reconcileConfirmed({
    store, getFinalizedSlot: async () => 40,
    onEvent: async () => {},
    canonicalResolver: async item => item.signature === "unclear"
      ? { state: "orphaned" } : { state: "unknown" }
  }), /verifiable evidence/);
});
