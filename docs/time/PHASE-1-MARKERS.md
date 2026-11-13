# Phase 1 Improvement Markers

**Baseline commit:** `e63c73b1ed1d1f839e44f06f00d1fdc1a6bd4a65`  
**Feature branch:** `feature/phase-1-deterministic-time-spine`  
**Version line:** `0.1.x` (pre-release; not production-ready)

| Marker | Meaning | Current state |
|---|---|---|
| P1-SPEC | Reviewed deterministic architecture and acceptance criteria | Committed |
| P1-CORE | Integer time and deterministic subsystem order | Implemented; tests added |
| P1-RECOVERY | Tick and snapshot rollback safety | Implemented; tests added |
| P1-HOST | Browser/Node runner lifecycle separation | Implemented; tests added |
| P1-CI | Exact implementation commit passes repository CI | Passed for merge commit `76973a40fb5769b146875f0ac3fb71cee5c27593`; GitHub Actions run [#23](https://github.com/JUSCR-FreeForAll/lost-legacies-live/actions/runs/43449444072) completed successfully (lint, typecheck, build, tests, Gitleaks) |
| P1-STAGING | Staging revision, health, and read-only verification | Pending; no staging target assumed |
| P1-RELEASE | Maintainer approval and explicit release authorization | Pending |

## Improvement cadence

1. Every milestone is a separately reviewable pull request or follow-on commit.
2. Each change updates this ledger with commit SHA, test evidence, compatibility impact, and rollback procedure.
3. Never mark CI, staging, security review, or release complete based only on source code being committed.
4. Create immutable Git tags/releases only after CI and maintainer approval. The current GitHub integration does not expose tag/release creation in this workflow, so these markers are recorded in version control and the PR until that capability is available.

## Next increments

- **0.1.1:** snapshot schema includes accumulator remainder and subsystem version identifiers.
- **0.1.2:** property-based replay tests and cross-runtime checksum vectors.
- **0.2.0:** staged external-effect queue with idempotency and commit boundary.
- **0.3.0:** persisted snapshots, migration compatibility, and recovery drills.
- **1.0.0:** only after staging soak, operational runbooks, security review, and signed release approval.
