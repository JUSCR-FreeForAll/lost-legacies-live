# Solana Anchor event ingestion

A transport-injected event listener for Lost Legacies Live. It subscribes at confirmed and finalized commitment, indexes decoded Anchor events in parser emission order, persists retry state, upgrades commitment without replaying completed side effects, and exposes Time Auction/JUSCR CloudEvents-shaped adapters.

Inject ws, Anchor EventParser, the exact deployed program ID and versioned IDL, RPC WebSocket URL, SQLite database, and idempotent downstream inbox. No endpoint, program ID, IDL, wallet, consumer, or production configuration is bundled.

Confirmed observations are provisional. Finalized is stronger chain commitment but not business authorization. Consumers must be idempotent because a crash can occur after side effect success and before acknowledgment.

WebSocket notifications are not a durable ledger. Production also requires finalized-history backfill, durable checkpoints, and confirmed-fork/orphan reconciliation. This package does not sign transactions, hold keys, make payments, grant permissions, or mutate Time Engine state.

Run pnpm --filter @lost-legacies/solana-events test and pnpm --filter @lost-legacies/solana-events lint. SQLite-driver integration, deployed-program fixtures, CPI ordering, and staging checks remain release gates.