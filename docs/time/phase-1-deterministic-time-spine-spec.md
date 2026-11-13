# Lost Legacies Live — Phase 1 Deterministic Time Engine & Spine

**Status:** Reviewed implementation specification; initial reference implementation accompanies this document.  
**Baseline:** `integration/phase-0-baseline`  
**Implementation branch:** `feature/phase-1-deterministic-time-spine`  
**Scope:** Deterministic time, subsystem orchestration, snapshot integrity, host-loop adaptation, and failure recovery.  
**Non-goals:** Database migrations, Solana transactions, user identity, participant content, external publication, payments, and deployment.

## 1. Architecture

1. **Time Engine:** converts host elapsed time into a count of fixed simulation ticks using integer microseconds.
2. **Spine Orchestrator:** executes registered subsystems in ascending priority, then stable lexical subsystem ID order. A tick commits only after every subsystem succeeds.
3. **SimulationRunner:** adapts browser animation frames or Node timers to elapsed integer microseconds. Rendering is an observer and never advances simulation state.

The simulation context contains only deterministic values: `tick` and `tickDurationUs`. Host clocks, frame timestamps, performance measurements, and telemetry remain outside it.

## 2. Time representation

- Canonical unit: integer microseconds (`µs`).
- Default tick duration: 50,000 µs (20 simulation ticks/second).
- Default accepted frame delta: at most 250,000 µs per host advance.
- Excess elapsed time is counted in `droppedTimeUs`; it is not silently folded into simulation state.
- Fractional microseconds are rounded at the host adapter boundary. Simulation code receives integers only.
- Tick count, accumulator, and configured durations must remain safe integers.

A rational tick representation is unnecessary for the initial implementation because the canonical unit and tick duration are integer-valued. If future tick rates cannot be represented exactly in microseconds, introduce a versioned rational numerator/denominator contract rather than reverting to floating-point accumulation.

## 3. Determinism and telemetry

- No `performance.now()`, `Date.now()`, random host values, rendering data, or I/O results may enter deterministic callbacks unless supplied as recorded, versioned simulation inputs.
- Telemetry is emitted after a committed tick and is best-effort. Telemetry failure cannot change simulation state.
- Replays must use the same ordered input log, engine version, tick duration, subsystem set, and subsystem versions.
- Subsystem update functions must be synchronous and deterministic for this initial engine. Async side effects require a separately designed command/effect boundary.

## 4. Stable orchestration and transaction semantics

Subsystem registration requires a unique stable ID, finite priority, update, snapshot, and restore callbacks. Ordering is `priority ASC, id ASC`.

Before each tick, the Spine captures every subsystem's rollback state. It then executes updates. On any failure, all subsystem states are restored in reverse execution order and the tick counter remains unchanged. If rollback itself fails, the Spine enters a halted state and raises an aggregate failure. Operators must restore from a known-good snapshot before resuming; automatic continuation is prohibited.

The snapshot/restore contract requires subsystem snapshot values to be complete, immutable or safely cloned, and local to the subsystem. Snapshot callbacks must not mutate live state.

## 5. Canonical checksum

The canonical serializer recursively sorts object keys, preserves array order, normalizes negative zero, rejects non-finite numbers and unsupported object types, and encodes BigInt as an explicit tagged decimal string (`{"$bigint":"…"}`). SHA-256 is computed over UTF-8 canonical JSON bytes.

This is a deterministic state checksum, not authentication, authorization, proof of authorship, or a substitute for a signed provenance record. Schema/version metadata must be included in the checksummed envelope by callers.

## 6. Snapshot validation and restore

Snapshot envelope v1:

```json
{
  "version": 1,
  "tick": 120,
  "subsystems": [
    { "id": "economy", "state": {} },
    { "id": "world", "state": {} }
  ]
}
```

Before any restore callback runs, validate:
- supported version and non-negative safe-integer tick;
- array shape and entry shape;
- unique subsystem IDs;
- no missing registered subsystem;
- no unexpected subsystem;
- exact subsystem count.

After validation, capture current rollback states, restore in stable order, then commit the snapshot tick. If restore fails, roll back all subsystems. A failed rollback halts the Spine. The current implementation resets fractional accumulator to zero on restore; preserving accumulator requires a future snapshot schema version.

## 7. Runner lifecycle

The runner selects one scheduler mode at construction:
- Browser: requestAnimationFrame + cancelAnimationFrame.
- Headless/Node: setTimeout + clearTimeout.

The selected cancellation pair is always used together. `stop()` is idempotent, clears the outstanding handle, and resets the previous host timestamp. The first frame establishes a baseline and does not advance time. Rendering receives tick and interpolation only.

## 8. Failure and recovery policy

| Failure | Required behavior |
|---|---|
| Invalid elapsed time | Reject before mutating clock state |
| Subsystem update throws | Restore all subsystem states; do not commit tick |
| Rollback fails | Halt Spine; require operator recovery |
| Snapshot invalid | Reject before any subsystem restore |
| Snapshot restore throws | Restore pre-restore state; halt if rollback fails |
| Telemetry callback throws | Ignore telemetry failure; preserve committed tick |
| Render callback throws | Reschedule lifecycle safely; host owner receives error |

The runner stops when simulation advancement fails. It does not continue ticking after an aborted or unrecoverable step.

## 9. Acceptance criteria

- [ ] Repeated identical integer elapsed-time sequences yield identical tick counts and accumulator remainders.
- [ ] Simulation callbacks receive no host clock or telemetry fields.
- [ ] Subsystem order is stable across registration order.
- [ ] A failed subsystem update leaves all subsystem state and committed tick unchanged when rollback succeeds.
- [ ] Failed rollback halts the Spine.
- [ ] Nested object key order does not affect canonical serialization or checksum.
- [ ] BigInt is explicitly represented; unsupported values and non-finite numbers are rejected.
- [ ] Duplicate, missing, unexpected, and malformed snapshot entries are rejected before any restore callback.
- [ ] Failed snapshot restoration rolls back; failed rollback halts the Spine.
- [ ] Browser runner pairs RAF with cancelAnimationFrame; Node runner pairs setTimeout with clearTimeout.
- [ ] Rendering cannot advance simulation time.
- [ ] CI runs package build, lint, typecheck, and tests.

## 10. Milestone markers

| Marker | Gate | Evidence required |
|---|---|---|
| P1-SPEC | Specification reviewed | This document and architecture decision committed |
| P1-CORE | Deterministic core | Integer accumulator, stable order, canonical serialization, unit tests |
| P1-RECOVERY | Recovery safety | Tick rollback, snapshot validation, restore rollback, halt behavior tests |
| P1-HOST | Host adapter | RAF/timeout cancellation tests; render/simulation separation |
| P1-CI | Continuous verification | Green CI run on the exact commit |
| P1-STAGING | Staging verification | Identified staging environment, deployed revision, read-only health and rollback evidence |
| P1-RELEASE | Release approval | Maintainer review, compatibility review, security/privacy review, explicit promotion authorization |

Markers P1-SPEC through P1-HOST describe committed code and tests in this change. P1-CI, P1-STAGING, and P1-RELEASE remain pending until corresponding external evidence exists. No tag or production-readiness claim is implied by a marker name.

## 11. Compatibility and integration boundaries

This is a new package under `packages/time-engine`; it does not assume the existence or behavior of other subsystem implementations. Integrations must register adapters that implement the snapshot/update/restore contract. Preserve independent product repositories and the existing private-by-default, explicit-consent boundaries. The engine has no database, network, blockchain, or financial side effects.

## 12. Implementation notes and known limits

- The first reference implementation is synchronous and in-memory.
- Subsystem snapshots must be complete and safe to restore; external side effects cannot be rolled back by in-memory snapshots.
- A future asynchronous command/effect system must stage external effects until after a deterministic commit and use idempotency keys.
- Checksum API uses Web Crypto SHA-256; runtime support must be checked in the target Node/browser environment.
- Snapshot v1 intentionally excludes accumulator remainder and dropped-time telemetry.
- The repository's CI must run before P1-CI can be marked complete.
