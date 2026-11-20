# Solana event ingestion integration

**Status:** Adapter package committed to an integration branch; production integration and chain verification remain incomplete.

The package @lost-legacies/solana-events provides a transport-injected Anchor listener, retryable delivery, a SQLite persistence adapter, and CloudEvents-shaped adapters for Time Auction and JUSCR.

## Flow
1. Subscribe at confirmed and finalized.
2. Decode using the supplied versioned Anchor IDL and EventParser.
3. Assign eventIndex across the complete decoded stream before consumer filters.
4. Persist by programId:signature:eventIndex.
5. Claim, dispatch to an idempotent consumer, and acknowledge only after success.
6. Upgrade commitment when finalized arrives without repeating completed side effects.
7. Backfill missed finalized history and reconcile confirmed observations through a separate worker.

## Production gates
- Run package lint and unit tests in CI; add SQLite-driver integration and restart tests.
- Replay real transaction fixtures from the deployed program and exact IDL.
- Test multiple events, CPI nesting, duplicate delivery, failure, crash/restart, and finality upgrades.
- Verify provider-specific fork/reorg handling and durable backfill checkpoints.
- Validate event schemas, program allowlists, identity/tenant authorization, consent, and audit records.
- Keep irreversible actions disabled until finalized and independently authorized.

No live endpoint, program ID, IDL, wallet, deployed program, or downstream consumer was supplied. No chain connectivity, deployed-program compatibility, staging behavior, or production readiness is claimed.