# Phoenix Fortress — Operations Guide

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | yes (secret) | 32 random bytes as 64 hex characters (or base64). Generate with `openssl rand -hex 32`. Anything else leaves readiness at `NOT_READY` / `ENCRYPTION_KEY_INVALID`. Never change it casually: it unwraps every tenant's recovery-key escrow and derives the signing key. |
| `FORTRESS_SIGNING_SEED` | optional (secret) | 32 bytes (hex/base64). Separates the signing key from the KEK. Setting or changing it after first boot changes the trust key → `RECOVERY_REQUIRED (TRUST_KEY_MISMATCH)` by design. |
| `FORTRESS_INSTALLATION_NAME` | optional | Part of every chain id. Set once, never change. Default `phoenix-fortress`. |
| `FORTRESS_ARCHIVE_DIR` | optional | JSONL archive directory. Default `.data/archive` (git-ignored). |
| `CLERK_*` | yes | Managed by the Clerk integration. |
| `DATABASE_URL` | yes | Managed by Replit. |

## Health

- `GET /api/healthz` — liveness. 200 while the process runs.
- `GET /api/readyz` — readiness. 200 `ready`; 503 `NOT_READY` (key missing/invalid,
  startup verification not finished) or `RECOVERY_REQUIRED` (open integrity
  condition). Route traffic and alerts on readiness, not liveness.
- Admin → **Diagnostics** shows every gate, open integrity conditions, the outbox
  backlog, key status and the pinned trust key.

## Running the acceptance suite

```bash
# one-time: create the schema in the separate test database
psql "$DATABASE_URL" -c 'CREATE DATABASE fortress_test'   # if missing
DATABASE_URL="${DATABASE_URL%/*}/fortress_test" pnpm --filter @workspace/db run push

pnpm --filter @workspace/api-server run test:fortress
```

The suite refuses to truncate any database whose name does not end in `_test`,
uses its own random KEK, never touches the development data, and writes
`docs/phoenix-fortress/evidence/latest.json`. Commit that file with the code it
was produced from; diagnostics marks gates **stale** when the source hash no
longer matches.

## Recovery drills (run quarterly)

1. **Lost device** — sign in on a new browser, Recovery → *Use a recovery code*.
   Confirm other sessions end and a new recovery key and codes are issued; save
   them, then confirm the new key.
2. **Stolen device** — Security → *Sign out everywhere else* and *Revoke all
   credentials*. Confirm the old browser is signed out and integrations get 401.
3. **Ransomware** — Recovery → *Download recovery package*. On an offline
   machine:
   ```bash
   node pfr-verify.mjs backup.pfr --trust-key ed25519:…   # from Diagnostics
   node pfr-verify.mjs backup.pfr --trust-key ed25519:… \
        --recovery-key-file key.txt --out ./restored
   ```
   Exit codes: 0 verified, 1 rejected, 2 usage, 3 wrong key / tampered.
4. **Bad backup** — restore planning on a corrupted item must be refused and
   raise `CIPHERTEXT_AUTH_FAILED`.
5. **Contact recovery** — with consenting contacts, start a request, collect
   approvals, wait out the delay, complete; then also practise cancelling.

Build the verifier with `pnpm --filter @workspace/fortress-core run build:verifier`
(output: `dist/offline-verifier/pfr-verify.mjs`). Keep a copy with your offline
media; it has no dependencies beyond Node.js 20+.

## Incident response: `RECOVERY_REQUIRED`

1. Do not resolve the condition first. Writes are paused on purpose.
2. Diagnostics → *Integrity conditions* lists the code (`HASH_MISMATCH`,
   `CHECKPOINT_CONTRADICTION`, `CHECKPOINT_BEYOND_TIP`, `CIPHERTEXT_AUTH_FAILED`,
   `TRUST_KEY_MISMATCH`, …) and affected tenant.
3. Preserve evidence: database snapshot, JSONL archive, recent `.pfr` packages.
4. Restore the database from the last known-good point (Replit checkpoint or
   database restore) or compare against the JSONL archive / `.pfr`.
5. *Verify ledger* again. *Resolve* checks every open condition on its own
   terms and clears only the ones that pass; the rest are listed in the 409:
   - ledger codes: the chain verifies from a consistent snapshot;
   - `CIPHERTEXT_AUTH_FAILED`: the named item decrypts again (or is no longer retained);
   - `CHECKPOINT_CONTRADICTION` / `CHECKPOINT_BEYOND_TIP`: the stored signed proof
     now agrees with local history, or its signer has been revoked
     (signer revocation is allowed while writes are paused);
   - `TRUST_KEY_MISMATCH`: the signing key matches the pinned key again.
6. If keys may be compromised: rotate recovery keys (Recovery → *Rotate*),
   revoke all credentials, sign out everywhere, and plan a KEK rotation.

## Session revocation

"Sign out everywhere", recovery codes and contact ceremonies record a cutoff
time and, after listing every provider session (all pages), each session id
that existed before it. Requests from those sessions are refused locally even
when the token was refreshed after the cutoff. If Clerk does not confirm a
revocation, the API returns `502 PROVIDER_REVOCATION_FAILED` (or
`providerRevocationPending: true` in recovery results) and a background job
retries every minute until Clerk confirms.

## Integrations

### JUSCR (REST)
1. Owner grants the `juscr_ingest` consent.
2. Credentials → *Issue* → kind **ingest**, choose the dataset, expiry ≤ 90 days.
   The token is shown once.
3. JUSCR calls:
   ```http
   POST /api/v1/ingest/backups
   Authorization: Bearer pf_…
   Content-Type: application/json

   {"data": { … }, "idempotencyKey": "juscr-<stable id>"}
   ```
   Retries with the same `idempotencyKey` return the original result
   (`replay: true`). Ingest credentials cannot read, export or call user routes.
4. Withdrawing the consent or revoking the credential stops ingest immediately.

### Seamcraft (provisional)
Register the sender's `ed25519:` key under Resilience → *Trusted signers* (kind
`seamcraft_sender`), grant `seamcraft_import`, and submit envelopes addressed to
the tenant's chain id. Each nonce is accepted once.

### JSON-LD
Grant `jsonld_import`. Only the bundled `https://w3id.org/phoenix-fortress/v1`
context and inline contexts are accepted; remote contexts are never fetched.

### Solana anchors
Grant `external_anchor`, create a checkpoint, *Prepare anchor*, write the exact
memo with your own wallet, then *Record* the transaction signature. Fortress does
not verify the transaction on-chain.

## Retention and deletion

- Dataset retention runs from Backups → *Apply retention*.
- Evidence deletion destroys the ciphertext and wrapped key (crypto-shredding);
  the ledger keeps only the id and checksum.
- Ledger blocks are never deleted.
