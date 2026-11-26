# Solana event ingestion integration

**Status (26 November 2026):** Experimental adapter on the draft PR branch.
Local tests and build have been exercised; no live chain, consumer, or staging
environment has been configured. PR #5 must remain draft until evidence is reviewed.

## Design boundary

1. The injected WebSocket subscribes to one allowlisted program at confirmed and finalized.
2. An injected Anchor EventParser emits logs in parser order. Each decoded event
   receives `programId:signature:eventIndex`, independently of consumer filters.
3. Confirmed observations are stored provisionally; the normal consumer callback
   is **finalized-only**. A separate callback may update read-only provisional UI.
4. SQLite or a memory store records the event, provenance, commitment and claim
   status. SQLite claims have attempt tokens, so stale workers cannot acknowledge
   work owned by a newer lease.
5. The host's independently authorized and idempotent consumer performs work,
   then the store acknowledges the attempt. A finality upgrade never automatically
   repeats an already completed side effect.
6. A host-configured finalized-history provider scans back to a verified durable
   signature checkpoint, decodes full transactions and fills WebSocket gaps.
   Incomplete scans fail before advancing the checkpoint.
7. A separately scheduled canonical reconciler examines confirmed observations
   older than the finalized root. It only marks orphaned records from positive
   host-verified evidence and retains a transition audit.

## Implemented and locally tested

| Capability | Evidence and boundary |
| --- | --- |
| Dual-commitment and parser indexing | In-memory WebSocket fixtures test failures, unknown subscriptions, duplicate notifications, multi-event ordering and upgrades |
| Finalized default delivery | Confirmed rows do not call `onEvent` absent an explicit override |
| Provenance | Versions required at listener construction and persisted with events |
| SQLite resilience | Real SQLite restart, expired-lease reclamation, attempt-token fencing and legacy table upgrade tests |
| History catch-up | Provider-injected, pagination/checkpoint fixture tests including missing checkpoint and downstream failure |
| Fork reconciliation | Host-verdict fixture tests; unknown/not-yet-rooted observations remain unresolved |
| Time Auction/JUSCR adapters | Explicit allowlists and external authorization gates, with finalized-only dispatch |
| Desktop CI build defect | Vite 6.4.1 is a pinned workspace dev dependency, invoked with `vite build` |

Tests asserting parser ordering with nested **log** events do not establish
`emit_cpi!` extraction. That macro emits event data in inner instructions, so
a log-only EventParser is insufficient for general CPI coverage. The injected
history decoder must explicitly handle both surfaces and preserve the same
event indices as live ingestion. The relevant deployed-program fixture is still
missing; do not claim CPI support from the synthetic fixture.

## Remaining gates before production

- **Remote CI:** push the branch, review GitHub Actions on the new head, and
  resolve any failures. Local success is not a remote green check.
- **Real program:** identify the program ID, deployed Anchor version, versioned
  IDL/hash, parser version and exact event fields; replay actual `emit!` and
  `emit_cpi!` transactions, including inner instructions and multiple events.
- **Backfill coverage:** choose a verified finalized bootstrap signature,
  provider-backed transaction history and RPC retention strategy. Test large
  outages and checkpoint loss against a real Solana provider.
- **Orphan evidence:** implement and test a provider-specific canonical resolver
  that distinguishes pruned/unknown signatures from genuinely orphaned ones.
- **Security:** integrate JSON-LD/Seamcraft contracts only after their schemas
  are published; enforce program allowlist, tenant isolation, identity, consent
  and audit. No mutable Time Engine state, permissions or economy actions.
- **Consumer safety:** end-to-end durable idempotent inbox/outbox and multi-worker
  lease tests using the actual chosen SQLite driver.
- **CRE:** if selected as an alternate event source, prove a deterministic map
  between CRE's block log index and this adapter's decoded event index. Do not
  assume the two IDs coincide.

## CI failure diagnosis

GitHub run [44759720257](https://github.com/JUSCR-FreeForAll/lost-legacies-live/actions/runs/44759720257)
on the original PR head `33f5aec` failed at the desktop build. Its Vite
configuration imported `vite`, but the desktop package did not declare Vite
as a dependency and invoked `npx --yes vite@6.4.1 build`. The corrected
desktop manifest and lockfile pin Vite as a local package dependency.

Nothing in this branch constitutes permission to merge the draft, activate
Solana connectivity, deploy an app, make payments or change another repository.
