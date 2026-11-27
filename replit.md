# Phoenix Fortress

A personal protection and recovery vault: encrypted, hash-chained backups and evidence, offline recovery packages, recovery codes and contacts, and verifiable restores that never overwrite live data.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/phoenix-fortress run dev` — admin web app
- `pnpm run typecheck` — full typecheck across all packages (`pnpm run typecheck:libs` after lib changes)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run test:fortress` — acceptance suite against the separate `fortress_test` database; writes `docs/phoenix-fortress/evidence/latest.json`
- `pnpm --filter @workspace/fortress-core run build:verifier` — standalone offline `.pfr` verifier
- Required env: `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY` (32 bytes, 64 hex chars), Clerk keys. See `docs/phoenix-fortress/OPERATIONS.md`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5; auth: Clerk
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Web: React + Vite + wouter + React Query

## Where things live

- `docs/phoenix-fortress/MASTER_ARCHITECTURE.md` — governing architecture, Flask/SQLite → this stack mapping, gates
- `docs/phoenix-fortress/OPERATIONS.md`, `PRODUCTION.md` — runbook and publish gate
- `lib/fortress-core` — framework-free core (canonical JSON, chain, checkpoints, envelopes, `.pfr`, adapters, CRDT, messages)
- `lib/db/src/schema/fortress.ts` — schema; `lib/api-spec/openapi.yaml` — API contract
- `artifacts/api-server/src/fortress`, `src/routes/fortress` — server; `tests/` — acceptance suite
- `artifacts/phoenix-fortress` — admin UI

## Architecture decisions

- Readiness fails closed: any verification failure → `RECOVERY_REQUIRED` and writes pause; liveness stays up.
- Recovery keys and extraction/ingest credentials are separate random secrets; only hashes or wrapped forms are stored.
- Acceptance gates are proven by tests tagged `[GateID]`; diagnostics marks evidence stale when hashed sources change.
- Diagnostics never claims production is verified; publishing waits for readiness plus every critical gate.

## Product

- Backups, staged restores, recovery key + saved codes, emergency recovery, recovery contacts with quorum and delay, consent registry, encrypted evidence, Safe Recovery mode + Quick Exit, witnesses/checkpoint import, JSON-LD/Seamcraft/JUSCR interop, optional Solana anchors.

## User preferences

- Follow the uploaded architecture document (adapted to this stack).

## Gotchas

- Tests refuse any database not ending in `_test`. Any edit to hashed sources makes evidence stale until the suite is rerun.
- Without a valid 32-byte `BACKUP_ENCRYPTION_KEY`, `/api/readyz` reports `NOT_READY` by design.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
