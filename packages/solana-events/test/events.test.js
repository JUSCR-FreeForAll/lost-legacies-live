import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { formatEventKey, MemoryEventStore, startDualCommitmentListener } from "../src/index.js";
import { toCloudEvent, createTimeAuctionAdapter, createJuscrAdapter } from "../src/adapters.js";

class Socket extends EventEmitter {
  readyState = 0;
  sent = [];
  constructor() {
    super();
    queueMicrotask(() => { this.readyState = 1; this.emit("open"); });
  }
  send(value) { this.sent.push(JSON.parse(value)); }
  ping() {}
  close() { this.readyState = 3; this.emit("close"); }
  message(value) { this.emit("message", Buffer.from(JSON.stringify(value))); }
}
const provenance = { anchorVersion: "1.2.2", parserVersion: "1.2.2", idlVersion: "test-fixture-1" };
const quiet = { error() {}, warn() {} };
const event = (commitment = "confirmed") => ({
  eventKey: "p:s:0", programId: "p", signature: "s", eventIndex: 0,
  eventName: "AuctionCreated", data: { amount: 123n }, commitment, slot: 4,
  observedAt: 0, provenance
});
const notification = (subscription, signature = "s", err = null) => ({
  method: "logsNotification", params: {
    subscription, result: { context: { slot: 4 }, value: { signature, err, logs: ["Program data: fixture"] } }
  }
});

test("event keys reject missing identity and negative indices", () => {
  assert.equal(formatEventKey({ programId: "p", signature: "s", eventIndex: 1 }), "p:s:1");
  assert.throws(() => formatEventKey({ programId: "p", signature: "s", eventIndex: -1 }));
});

test("memory store upgrades finality, preserves completion and finalized slot on late confirmed", async () => {
  const store = new MemoryEventStore();
  await store.put(event());
  const token = await store.claim("p:s:0");
  assert.equal(token, 1);
  await store.complete("p:s:0", token);
  const result = await store.put({ ...event("finalized"), slot: 5 });
  assert.equal(result.upgraded, true);
  await store.put({ ...event("confirmed"), slot: 3 });
  assert.equal((await store.get("p:s:0")).slot, 5);
  assert.equal((await store.get("p:s:0")).status, "processed");
  assert.equal(await store.claim("p:s:0"), false);
});

test("listener stores confirmed provisionally and delivers only finalized by default", async () => {
  const socket = new Socket(), store = new MemoryEventStore(), got = [], provisional = [], upgrades = [];
  const listener = startDualCommitmentListener({
    wsUrl: "wss://example.invalid", programId: "p", store, provenance,
    createWebSocket: () => socket,
    createEventParser: () => ({ parseLogs: () => [{ name: "A" }, { name: "B" }] }),
    onEvent: e => got.push(e), onProvisionalObservation: e => provisional.push(e),
    onCommitmentUpgrade: e => upgrades.push(e), logger: quiet
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(socket.sent.filter(e => e.method === "logsSubscribe").map(e => e.params[1].commitment),
    ["confirmed", "finalized"]);
  socket.message({ id: 1, result: 11 });
  socket.message({ id: 2, result: 22 });
  socket.message(notification(999));
  socket.message(notification(11, "failed", { InstructionError: [0, "Custom"] }));
  socket.message(notification(11));
  await listener.waitForIdle();
  assert.equal(got.length, 0);
  assert.deepEqual(provisional.map(e => e.eventIndex), [0, 1]);
  socket.message(notification(22));
  await listener.waitForIdle();
  assert.deepEqual(got.map(e => e.eventIndex), [0, 1]);
  assert.equal(upgrades.length, 2);
  assert.deepEqual(got.map(e => e.provenance.anchorVersion), ["1.2.2", "1.2.2"]);
  socket.message(notification(22));
  await listener.waitForIdle();
  assert.equal(got.length, 2);
  listener.stop();
});

test("nested log parser order is stable across commitment upgrades", async () => {
  const socket = new Socket(), indices = [], store = new MemoryEventStore();
  const parser = { parseLogs: () => [
    { name: "Outer" }, { name: "InnerCpiLog" }, { name: "OuterAgain" }
  ] };
  const listener = startDualCommitmentListener({
    wsUrl: "wss://example.invalid", programId: "p", store, provenance,
    createWebSocket: () => socket, createEventParser: () => parser,
    onEvent: e => indices.push(e.eventIndex), logger: quiet
  });
  await new Promise(resolve => setImmediate(resolve));
  socket.message({ id: 1, result: 11 }); socket.message({ id: 2, result: 22 });
  socket.message(notification(11)); socket.message(notification(22));
  await listener.waitForIdle();
  assert.deepEqual(indices, [0, 1, 2]);
  listener.stop();
});

test("parser/version provenance is mandatory", () => {
  assert.throws(() => startDualCommitmentListener({
    wsUrl: "wss://example.invalid", programId: "p", store: new MemoryEventStore(),
    createWebSocket: () => new Socket(), createEventParser: () => ({ parseLogs() {} }),
    onEvent() {}
  }), /provenance/);
});

test("CloudEvent metadata and adapters enforce finality, allowlists and authorization", async () => {
  const source = { ...event("finalized"), data: { amount: "123" } };
  const cloud = toCloudEvent(source, { projectId: "timeauction" });
  assert.equal(cloud.data.project_id, "timeauction");
  assert.equal(cloud.data.provenance.anchorVersion, "1.2.2");
  assert.equal(JSON.parse(JSON.stringify(toCloudEvent(event("finalized"), { projectId: "juscr" })))
    .data.payload.amount, "123");
  const delivered = [];
  const dispatch = createTimeAuctionAdapter({
    dispatch: e => delivered.push(e), acceptedEvents: ["AuctionCreated"],
    authorize: async e => e.data.payload.amount === "123"
  });
  await dispatch({ ...source, commitment: "confirmed" });
  await dispatch({ ...source, eventName: "Other" });
  await dispatch(source);
  assert.equal(delivered.length, 1);
  await createJuscrAdapter({
    publish: e => delivered.push(e), acceptedEvents: ["AuctionCreated"], authorize: () => false
  })(source);
  assert.equal(delivered.length, 1);
  assert.throws(() => createTimeAuctionAdapter({ dispatch() {} }), /allowlist/);
});

test("orphaning provisional memory records is auditable and prevents replay", async () => {
  const store = new MemoryEventStore();
  await store.put(event());
  assert.equal(await store.markOrphaned("p:s:0", "finalized root and canonical provider evidence"), true);
  assert.equal((await store.get("p:s:0")).status, "orphaned");
  assert.equal(await store.claim("p:s:0"), false);
  assert.equal((await store.listTransitions())[0].transition, "orphaned");
  await assert.rejects(store.put(event("finalized")), /resurrect/);
});

test("startup and reconnect both request history catch-up", async () => {
  const sockets = [], catchups = [];
  const listener = startDualCommitmentListener({
    wsUrl: "wss://example.invalid", programId: "p", provenance,
    store: new MemoryEventStore(),
    createWebSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; },
    createEventParser: () => ({ parseLogs: () => [] }),
    onEvent: async () => {}, onHistoryCatchUp: info => catchups.push(info.reconnect),
    maxReconnectDelayMs: 1, logger: quiet
  });
  try {
    await new Promise(resolve => setImmediate(resolve));
    await listener.waitForIdle();
    assert.deepEqual(catchups, [false]);
    sockets[0].close();
    await new Promise(resolve => setTimeout(resolve, 30));
    await listener.waitForIdle();
    assert.equal(sockets.length, 2);
    assert.deepEqual(catchups, [false, true]);
  } finally {
    listener.stop();
  }
});
