# ADR-007 — Deterministic Time Engine and Spine Orchestration

**Status:** Accepted for Phase 1 implementation; production adoption remains gated.  
**Date:** 2026-11-13

## Context

The Phase 1 proposal separates a deterministic Time Engine, a Spine Orchestrator, and a host-facing SimulationRunner. Review identified risks from host clock leakage, floating-point accumulation, non-canonical checksums, unsafe snapshot restore, incorrect timer cancellation, and partial subsystem advancement.

The integration repository preserves product independence and requires evidence-led readiness claims. Its existing Time/Energy design also requires private, reversible prototypes and separate authorization for sharing, financial activity, and external deployment.

## Decision

1. Represent simulation time as integer microseconds with a fixed tick duration.
2. Keep host timestamps and telemetry outside deterministic simulation contexts.
3. Order subsystems by numeric priority then stable ID.
4. Capture rollback snapshots before each tick; commit tick count only after all subsystem updates succeed.
5. Halt on rollback failure.
6. Validate complete snapshot membership before invoking any restore callback; roll back a failed restore.
7. Canonicalize nested object keys recursively and encode BigInt explicitly before SHA-256.
8. Bind scheduling and cancellation to the same host mechanism (RAF/cancelRAF or timeout/clearTimeout).
9. Keep this package in-memory and side-effect-free. No database, network, blockchain, publication, or financial action is enabled.

## Consequences

- Subsystems must expose deterministic update and complete snapshot/restore callbacks.
- External effects need a separately reviewed post-commit command boundary; they cannot be undone by in-memory rollback.
- Snapshot v1 resets accumulator remainder on restore; a later schema version may preserve it.
- This is a foundation and reference implementation, not a production-readiness certification.

## Verification

Package-level Node tests cover integer accumulation, stable ordering, rollback, halt behavior, canonical BigInt serialization, snapshot membership validation, restore, and Node timer cleanup. Repository CI, staging, security review, and release gates remain independently pending until evidence is available.
