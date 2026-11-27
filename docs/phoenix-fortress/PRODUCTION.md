# Phoenix Fortress — Production Guide

Nothing is published until every item below is true. The diagnostics page
reports `publishable: true` only when readiness is `ready` and every critical
gate has fresh passing evidence; it always reports `productionVerified: false`,
because development evidence cannot prove the published environment.

## Publish gate

1. `pnpm run typecheck` passes.
2. `pnpm --filter @workspace/api-server run test:fortress` passes with 0
   failures and no uncovered automated gate; `evidence/latest.json` is committed
   with the same source.
3. Diagnostics (development) shows every critical gate **passed** (not stale)
   and readiness **ready**.
4. G13 accessibility review has been done by a person: complete the recovery
   path with keyboard only and with a screen reader, at 200% zoom. The
   keyboard review, fixes and the remaining sign-off checklist are in
   `evidence/g13-accessibility-review.md`.
5. Production secrets are set (see below) and differ from development.

## Production secrets

- `BACKUP_ENCRYPTION_KEY`: 64 hex characters from `openssl rand -hex 32`, set
  as a deployment secret. Store an offline copy in a sealed location; losing it
  makes server-side recovery-key escrow unrecoverable (owners' own recovery keys
  and `.pfr` packages still work).
- `FORTRESS_SIGNING_SEED` (recommended): a separate 32-byte value, so the
  signing key and the KEK can be rotated independently. Decide before first
  boot.
- `FORTRESS_INSTALLATION_NAME`: set once.

## Deployment shape

- Reserved VM is preferred (long-running outbox exporter, steady startup
  verification). Autoscale works but cold starts repeat startup verification.
- One external port; the server binds `PORT` on all interfaces.
- Database: Replit PostgreSQL. Push schema changes to production deliberately
  (see the database guidance); never point tests at production.
- The JSONL archive directory is on ephemeral disk in deployments. It is a
  convenience export, not the survival copy. Owners must download `.pfr`
  packages and keep them offline.

## After publishing

1. Hit `/api/readyz` on the published URL: it must return `ready`.
2. Sign in, set up a recovery key, take a backup, download a `.pfr`, and verify
   it offline with the trust key shown in production diagnostics.
3. Record the production trust key (`ed25519:…`) offline. It is the anchor for
   every future offline verification.
4. Schedule the quarterly drills in `OPERATIONS.md`.
