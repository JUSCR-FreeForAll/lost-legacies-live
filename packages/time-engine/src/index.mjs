/**
 * Deterministic simulation primitives.
 * All simulation time is integer microseconds; host telemetry is intentionally
 * excluded from TickContext and from checksummed state.
 */

export const DEFAULT_TICK_US = 50_000;

export class TimeEngine {
  constructor({ tickDurationUs = DEFAULT_TICK_US, maxFrameDeltaUs = 250_000 } = {}) {
    assertPositiveSafeInteger(tickDurationUs, "tickDurationUs");
    assertPositiveSafeInteger(maxFrameDeltaUs, "maxFrameDeltaUs");
    this.tickDurationUs = tickDurationUs;
    this.maxFrameDeltaUs = maxFrameDeltaUs;
    this.accumulatorUs = 0;
    this.tick = 0;
    this.droppedTimeUs = 0;
  }

  advance(elapsedUs) {
    assertNonNegativeSafeInteger(elapsedUs, "elapsedUs");
    const acceptedUs = Math.min(elapsedUs, this.maxFrameDeltaUs);
    this.droppedTimeUs += elapsedUs - acceptedUs;
    this.accumulatorUs += acceptedUs;
    const due = Math.floor(this.accumulatorUs / this.tickDurationUs);
    this.accumulatorUs -= due * this.tickDurationUs;
    return due;
  }

  commitTick() {
    if (!Number.isSafeInteger(this.tick + 1)) throw new RangeError("tick counter exceeded safe integer range");
    this.tick += 1;
    return this.tick;
  }

  reset({ tick = 0, accumulatorUs = 0 } = {}) {
    assertNonNegativeSafeInteger(tick, "tick");
    assertNonNegativeSafeInteger(accumulatorUs, "accumulatorUs");
    if (accumulatorUs >= this.tickDurationUs) throw new RangeError("accumulatorUs must be smaller than tickDurationUs");
    this.tick = tick;
    this.accumulatorUs = accumulatorUs;
    this.droppedTimeUs = 0;
  }

  get interpolationRatio() {
    return this.accumulatorUs / this.tickDurationUs;
  }
}

function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export class SpineOrchestrator {
  constructor({ timeEngine = new TimeEngine(), onTelemetry = () => {} } = {}) {
    this.time = timeEngine;
    this.onTelemetry = onTelemetry;
    this.subsystems = new Map();
    this.halted = false;
  }

  register({ id, priority = 0, update, snapshot, restore }) {
    if (this.subsystems.has(id)) throw new Error(`duplicate subsystem id: ${id}`);
    if (typeof id !== "string" || !id.trim()) throw new TypeError("subsystem id is required");
    if (!Number.isFinite(priority)) throw new TypeError("priority must be finite");
    for (const [name, fn] of Object.entries({ update, snapshot, restore })) {
      if (typeof fn !== "function") throw new TypeError(`${name} must be a function`);
      if (fn.constructor?.name === "AsyncFunction") throw new TypeError(`${name} must be synchronous`);
    }
    this.subsystems.set(id, { id, priority, update, snapshot, restore });
  }

  orderedSubsystems() {
    return [...this.subsystems.values()].sort((a, b) => {
      const priorityDelta = a.priority - b.priority;
      if (priorityDelta !== 0) return priorityDelta;
      return compareStrings(a.id, b.id);
    });
  }

  step() {
    if (this.halted) throw new Error("Spine is halted after an unrecoverable rollback failure");
    const nextTick = this.time.tick + 1;
    const ordered = this.orderedSubsystems();
    const before = new Map();
    for (const subsystem of ordered) before.set(subsystem.id, subsystem.snapshot());
    const context = Object.freeze({ tick: nextTick, tickDurationUs: this.time.tickDurationUs });
    try {
      for (const subsystem of ordered) {
        const result = subsystem.update(context);
        if (result && typeof result.then === "function") {
          throw new TypeError(`subsystem ${subsystem.id} update returned a Promise; updates must be synchronous`);
        }
      }
      this.time.commitTick();
      return nextTick;
    } catch (cause) {
      const rollbackErrors = [];
      for (const subsystem of [...ordered].reverse()) {
        try { subsystem.restore(before.get(subsystem.id)); }
        catch (error) { rollbackErrors.push({ subsystem: subsystem.id, error }); }
      }
      if (rollbackErrors.length) {
        this.halted = true;
        const details = rollbackErrors.map(x => `${x.subsystem}: ${String(x.error)}`).join("; ");
        throw new AggregateError([cause, ...rollbackErrors.map(x => x.error)], `tick ${nextTick} failed and rollback was incomplete: ${details}`);
      }
      throw new Error(`tick ${nextTick} aborted; all subsystem state was restored`, { cause });
    }
  }

  advance(elapsedUs) {
    const due = this.time.advance(elapsedUs);
    let completed = 0;
    for (let i = 0; i < due; i += 1) {
      const startedAt = globalThis.performance?.now?.();
      try {
        this.step();
        completed += 1;
        const durationMs = startedAt === undefined ? undefined : globalThis.performance.now() - startedAt;
        try { this.onTelemetry({ tick: this.time.tick, durationMs, completed }); } catch { /* telemetry cannot alter simulation */ }
      } catch (error) {
        this.time.accumulatorUs += (due - i) * this.time.tickDurationUs;
        throw error;
      }
    }
    return completed;
  }
}

export function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("checksum state cannot contain non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") return ["$bigint", value.toString(10)];
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError("checksum state must contain only plain objects, arrays, and primitives");
    }
    const plain = Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
    if (Object.hasOwn(plain, "$bigint")) {
      throw new TypeError("checksum state cannot use the reserved $bigint key");
    }
    return plain;
  }
  throw new TypeError(`unsupported checksum value: ${typeof value}`);
}

export function canonicalSerialize(value) {
  return JSON.stringify(canonicalize(value));
}

export async function checksum(value) {
  const bytes = new TextEncoder().encode(canonicalSerialize(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Snapshot shape:
 * { version: 1, tick: number, accumulatorUs: number, droppedTimeUs: number, subsystems: [{ id, state }, ...] }
 * Validate the complete set before touching live state, then roll back if a
 * restore callback fails. Subsystem restore callbacks must be idempotent.
 */
export function captureSnapshot(orchestrator) {
  const subsystems = orchestrator.orderedSubsystems().map(s => ({ id: s.id, state: s.snapshot() }));
  return { version: 1, tick: orchestrator.time.tick, accumulatorUs: orchestrator.time.accumulatorUs, droppedTimeUs: orchestrator.time.droppedTimeUs, subsystems };
}

export function validateSnapshot(snapshot, orchestrator) {
  if (!snapshot || snapshot.version !== 1 || !Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0 || !Array.isArray(snapshot.subsystems)) {
    throw new TypeError("invalid snapshot envelope");
  }
  if (!Number.isSafeInteger(snapshot.accumulatorUs ?? 0) || (snapshot.accumulatorUs ?? 0) < 0) {
    throw new TypeError("invalid snapshot accumulatorUs");
  }
  const expected = new Set(orchestrator.subsystems.keys());
  const seen = new Set();
  for (const entry of snapshot.subsystems) {
    if (!entry || typeof entry.id !== "string" || !Object.hasOwn(entry, "state")) throw new TypeError("invalid snapshot entry");
    if (seen.has(entry.id)) throw new Error(`duplicate snapshot subsystem: ${entry.id}`);
    if (!expected.has(entry.id)) throw new Error(`unexpected snapshot subsystem: ${entry.id}`);
    seen.add(entry.id);
  }
  for (const id of expected) if (!seen.has(id)) throw new Error(`missing snapshot subsystem: ${id}`);
  if (snapshot.subsystems.length !== expected.size) throw new Error("snapshot subsystem count mismatch");
  return true;
}

export function restoreSnapshot(snapshot, orchestrator) {
  validateSnapshot(snapshot, orchestrator);
  const ordered = orchestrator.orderedSubsystems();
  const states = new Map(snapshot.subsystems.map(entry => [entry.id, entry.state]));
  const before = new Map(ordered.map(s => [s.id, s.snapshot()]));
  try {
    for (const subsystem of ordered) subsystem.restore(states.get(subsystem.id));
    orchestrator.halted = false;
    orchestrator.time.reset({
      tick: snapshot.tick,
      accumulatorUs: snapshot.accumulatorUs ?? 0,
    });
    orchestrator.time.droppedTimeUs = snapshot.droppedTimeUs ?? 0;
  } catch (cause) {
    const rollbackErrors = [];
    for (const subsystem of [...ordered].reverse()) {
      try { subsystem.restore(before.get(subsystem.id)); }
      catch (error) { rollbackErrors.push(error); }
    }
    if (rollbackErrors.length) {
      orchestrator.halted = true;
      throw new AggregateError([cause, ...rollbackErrors], "snapshot restore failed and rollback was incomplete");
    }
    throw new Error("snapshot restore failed; live state was rolled back", { cause });
  }
}

function assertPositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
}
function assertNonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
}

