import test from "node:test";
import assert from "node:assert/strict";
import { TimeEngine, SpineOrchestrator, canonicalSerialize, captureSnapshot, restoreSnapshot, validateSnapshot } from "../src/index.mjs";
import { SimulationRunner } from "../src/runner.mjs";

test("integer accumulator emits exact fixed ticks", () => {
  const clock = new TimeEngine({ tickDurationUs: 10_000, maxFrameDeltaUs: 100_000 });
  assert.equal(clock.advance(3_333), 0);
  assert.equal(clock.advance(6_667), 1);
  assert.equal(clock.accumulatorUs, 0);
  assert.equal(clock.advance(25_000), 2);
  assert.equal(clock.tick, 0);
});

test("frame delta is bounded and excess time is observable", () => {
  const clock = new TimeEngine({ tickDurationUs: 10_000, maxFrameDeltaUs: 25_000 });
  assert.equal(clock.advance(40_000), 2);
  assert.equal(clock.droppedTimeUs, 15_000);
});

test("spine orders by locale-independent string comparison", () => {
  const spine = new SpineOrchestrator({ timeEngine: new TimeEngine() });
  for (const id of ["ä", "Z", "a"]) spine.register({ id, update() {}, snapshot: () => 0, restore() {} });
  assert.deepEqual(spine.orderedSubsystems().map(s => s.id), ["Z", "a", "ä"]);
});

test("subsystem failure restores every subsystem and does not commit tick", () => {
  const spine = new SpineOrchestrator();
  const state = { a: 0, b: 0 };
  spine.register({ id: "a", priority: 0, update: () => state.a++, snapshot: () => state.a, restore: x => { state.a = x; } });
  spine.register({ id: "b", priority: 1, update: () => { state.b++; throw new Error("boom"); }, snapshot: () => state.b, restore: x => { state.b = x; } });
  assert.throws(() => spine.step(), /all subsystem state was restored/);
  assert.deepEqual(state, { a: 0, b: 0 });
  assert.equal(spine.time.tick, 0);
});

test("incomplete rollback halts the spine", () => {
  const spine = new SpineOrchestrator();
  spine.register({ id: "bad", update: () => { throw new Error("update"); }, snapshot: () => 0, restore: () => { throw new Error("rollback"); } });
  assert.throws(() => spine.step(), AggregateError);
  assert.equal(spine.halted, true);
  assert.throws(() => spine.step(), /halted/);
});

test("async subsystem callbacks are rejected at registration", () => {
  const spine = new SpineOrchestrator();
  assert.throws(() => spine.register({ id: "async", update: async () => {}, snapshot: () => 0, restore() {} }), /synchronous/);
  assert.throws(() => spine.register({ id: "async-snapshot", update() {}, snapshot: async () => 0, restore() {} }), /synchronous/);
});

test("thenable update results abort and roll back before tick commit", () => {
  const spine = new SpineOrchestrator();
  let value = 0;
  spine.register({ id: "thenable", update() { value++; return { then() {} }; }, snapshot: () => value, restore: x => { value = x; } });
  assert.throws(() => spine.step(), /returned a Promise/);
  assert.equal(value, 0);
  assert.equal(spine.time.tick, 0);
});

test("canonical serialization sorts keys and avoids bigint/object marker collision", () => {
  assert.equal(canonicalSerialize({ z: 1n, a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"z":["$bigint","1"]}');
  assert.equal(canonicalSerialize({ b: 2, a: 1 }), canonicalSerialize({ a: 1, b: 2 }));
  assert.throws(() => canonicalSerialize({ "$bigint": "1" }), /reserved \$bigint key/);
});

test("snapshot rejects invalid entries before restoring any subsystem", () => {
  const spine = new SpineOrchestrator();
  let restores = 0;
  for (const id of ["a", "b"]) spine.register({ id, update() {}, snapshot: () => 0, restore: () => restores++ });
  const valid = captureSnapshot(spine);
  assert.equal(validateSnapshot(valid, spine), true);
  for (const subsystems of [[{ id: "a", state: 0 }, { id: "a", state: 1 }], [{ id: "a", state: 0 }], [{ id: "a", state: 0 }, { id: "c", state: 0 }], [{ id: "a" }, { id: "b", state: 0 }]]) {
    assert.throws(() => restoreSnapshot({ ...valid, subsystems }, spine));
  }
  assert.equal(restores, 0);
});

test("snapshot restore reapplies partial tick and clears halted status", () => {
  const spine = new SpineOrchestrator();
  let value = 7;
  spine.halted = true;
  spine.register({ id: "counter", update() {}, snapshot: () => value, restore: x => { value = x; } });
  restoreSnapshot({ version: 1, tick: 42, accumulatorUs: 5_000, droppedTimeUs: 9, subsystems: [{ id: "counter", state: 99 }] }, spine);
  assert.equal(value, 99);
  assert.equal(spine.time.tick, 42);
  assert.equal(spine.time.accumulatorUs, 5_000);
  assert.equal(spine.time.droppedTimeUs, 9);
  assert.equal(spine.halted, false);
});

test("runner uses clearTimeout for timeout scheduling cleanup", () => {
  const cleared = [];
  const runner = new SimulationRunner({ spine: new SpineOrchestrator(), setTimer: () => 17, clearTimer: id => cleared.push(id) });
  runner.start();
  runner.stop();
  assert.deepEqual(cleared, [17]);
});

test("failed tick keeps its elapsed time pending for explicit recovery", () => {
  const spine = new SpineOrchestrator({ timeEngine: new TimeEngine({ tickDurationUs: 10_000 }) });
  let shouldFail = true;
  let value = 0;
  spine.register({ id: "state", update: () => { if (shouldFail) throw new Error("temporary"); value++; }, snapshot: () => value, restore: x => { value = x; } });
  assert.throws(() => spine.advance(20_000), /all subsystem state was restored/);
  assert.equal(spine.time.tick, 0);
  assert.equal(spine.time.accumulatorUs, 20_000);
  shouldFail = false;
  assert.equal(spine.advance(0), 1);
  assert.equal(spine.time.tick, 1);
  assert.equal(value, 1);
});
