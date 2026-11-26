# Solana Anchor event ingestion (experimental)

This package is an opt-in, self-hosted event boundary. It does not connect to a
chain, access a wallet, grant permissions, make payments, or modify Time Engine
state without explicit host integration. There is no bundled RPC address,
program ID, IDL, credential, production consumer, or deployed-program fixture.

## What it does

- Subscribes to confirmed and finalized program log notifications with an
  injected WebSocket and Anchor-compatible `EventParser`.
- Records confirmed observations as **provisional**. By default, only finalized
  observations invoke `onEvent`; `allowConfirmedDelivery` is an explicit unsafe
  override intended only for independently reversible consumers.
- Indexes each parser output in complete emission order as
  `programId:signature:eventIndex` before downstream event filtering.
- Records `anchorVersion`, `parserVersion`, and `idlVersion` provenance on
  each observation. The host should also supply an IDL content hash and verify
  the parser and on-chain program actually match those versions.
- Deduplicates finalized delivery and upgrades previously confirmed rows.
- Provides a memory store and a synchronous SQLite store with lease-token
  fencing, retry, durable checkpoints, and append-only finality/orphan records.
- Exposes an injected, bounded finalized-history backfill and a conservative
  canonical reconciliation interface under `@lost-legacies/solana-events/recovery`.
- Provides Time Auction and JUSCR CloudEvents-shaped adapters requiring an
  explicit event-name allowlist and an authorization callback.

## Host wiring

Create a WebSocket, SQLite database and Anchor parser in your host:

```js
import { startDualCommitmentListener } from "@lost-legacies/solana-events";
import { SqliteEventStore } from "@lost-legacies/solana-events/sqlite";
import { runFinalizedBackfill, reconcileConfirmed } from "@lost-legacies/solana-events/recovery";

const store = new SqliteEventStore(hostOpenedBetterSqlite3Db);
const provenance = {
  anchorVersion: hostVerifiedAnchorVersion,
  parserVersion: hostVerifiedParserVersion,
  idlVersion: hostVerifiedIdlVersion,
  idlSha256: hostVerifiedIdlSha256
};
const listener = startDualCommitmentListener({
  wsUrl: configuredWsUrl,
  programId: allowlistedProgramId,
  idl: deployedProgramIdl,
  provenance,
  store,
  createWebSocket: url => hostWebSocketFactory(url),
  createEventParser: (programId, idl) => hostAnchorEventParser(programId, idl),
  onEvent: event => authorizedIdempotentInbox(event),
  onProvisionalObservation: event => updateReadOnlyProvisionalUi(event),
  onHistoryCatchUp: () => runFinalizedBackfill({
    provider: hostHistoricalRpc, programId: allowlistedProgramId, store,
    programAddress: hostSolanaPublicKey, // @solana/web3.js Connection requires PublicKey
    decodeTransaction: hostDecoderWithCanonicalCpiOrdering,
    onEvent: event => authorizedIdempotentInbox(event),
    provenance,
    startingSignature: verifiedFinalizedBootstrapSignature
  })
});

// Host must schedule reconciliation and validate canonical evidence itself.
await reconcileConfirmed({
  store,
  getFinalizedSlot: () => hostHistoricalRpc.getFinalizedSlot(),
  canonicalResolver: event => hostVerifiedCanonicalVerdict(event),
  onEvent: event => authorizedIdempotentInbox(event)
});
```

These variables/functions are host-provided placeholders, not shipped
implementations. Do not paste this example into production without providing
the underlying identity, tenant, consent, validator, chain, and provider controls.

## Reliability and event identity

- A SQLite claim returns an attempt token. Pass that token to
  `complete(eventKey, token)` or `fail(eventKey, error, token)`; a stale lease
  holder cannot acknowledge a newer claim.
- Restart recovery reclaims expired leases. External side effects still require
  durable consumer idempotency or a transactional outbox; a crash after the
  side effect but before acknowledgement can cause an attempted repeat.
- `runFinalizedBackfill` requires a known historical checkpoint or an explicit
  verified finalized starting signature. It fails closed if the history provider
  cannot find that checkpoint, a required transaction is missing, decoding fails,
  or the downstream handler fails. Checkpoints advance only after success.
- `reconcileConfirmed` only marks an event orphaned when the host supplies
  explicit canonical evidence; an absent RPC status alone is not proof. Both
  finality upgrades and orphan verdicts are retained as transitions.
- The index is the **decoded event ordinal**, not Solana's block log position.
  It is only stable if live and history decoders enumerate the same complete
  ordered stream. In particular, real `emit_cpi!` inner-instruction extraction
  is not implemented by the live log-only parser. The historical decoder must
  be provided by the host and tested with actual deployed-program fixtures.

## Production blockers

1. Verify the exact deployed program ID, Anchor runtime version, parser version,
   IDL hash/schema, and both `emit!` and `emit_cpi!` fixtures. Compare live
   event indices with historical transaction decoding (including CPI nesting).
2. Configure a history-capable finalized RPC provider, bootstrap checkpoint,
   durable SQLite storage, and a provider-specific canonical fork verdict;
   verify RPC pruning, pagination and retention under realistic outages.
3. Validate event field schemas, program allowlists, identity and tenant
   authorization, purpose-bound consent, audit records and consumer idempotency.
   Finality never constitutes business authorization.
4. Verify SQLite restart, race and failure tests on Node 22 in CI and run
   staging tests with the real provider. No production consumer or external
   economic action should be enabled before these are evidenced.
5. Treat CRE as a separate optional source. Its block-log-index identity cannot
   be inserted into this key space without an independently verified mapping
   to the canonical decoded-event ordinal; no CRE connector is enabled here.

Local verification: `pnpm --filter @lost-legacies/solana-events test` and
`pnpm --filter @lost-legacies/solana-events lint`. The Node built-in SQLite
test driver requires Node >=22.13; runtime consumers can inject a
better-sqlite3-compatible database.
