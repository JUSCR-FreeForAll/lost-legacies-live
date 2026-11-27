# Phoenix Fortress — Master Architecture

This is the governing architecture for Phoenix Fortress in this project. The
uploaded source document (converted copy in `source-architecture.md`) was
written for a Flask + SQLite + Socket.IO prototype. This file keeps its
security invariants, phases and acceptance gates, and records exactly how each
piece maps onto this project's TypeScript / Express 5 / PostgreSQL / Clerk
stack.

Related documents:

- `OPERATIONS.md` — day-to-day runbook, drills, incident response.
- `PRODUCTION.md` — publishing checklist and the publish gate.
- `evidence/latest.json` — the most recent acceptance-suite run, with the hash
  of the source it ran against.

## 1. Scope and safety boundary

Phoenix Fortress is an independent, reusable protection and recovery service.
It protects a person's data, identity access and service continuity; it does
not surveil anyone. It never collects location, IP address, device fingerprints
or contact-network data, never sends email/SMS/push, and never places personal
information on a public ledger.

## 2. Non-negotiable invariants

| # | Invariant | Where it is enforced |
|---|-----------|----------------------|
| I1 | Every state change is an authenticated, authorized, atomic, idempotent commit | `fortress/tx.ts` (`runIdempotent`), `fortress/auth.ts` |
| I2 | The ledger is a versioned, canonical (RFC 8785 JCS) SHA-256 hash chain with deterministic genesis | `lib/fortress-core/src/canonical.ts`, `chain.ts` |
| I3 | Readiness fails closed: any verification failure → `RECOVERY_REQUIRED`, writes pause | `fortress/integrity.ts`, `/api/readyz` |
| I4 | Signed checkpoints (Ed25519) detect wholesale ledger rewrites | `checkpoint.ts`, `fortress/checkpoints.ts` |
| I5 | Recovery keys and extraction/ingest credentials are separate, random, never derived from each other | `fortress/keys.ts`, `fortress/vault.ts`, `routes/fortress/credentials.ts` |
| I6 | No secret (recovery key, code, token, KEK, plaintext) is stored in clear or written to the ledger | `assertNoSecretMaterial`, gate G12 |
| I7 | Consent is explicit, per purpose, revocable, and checked inside the committing transaction | `fortress/protection.ts` (`requireConsent`) |
| I8 | Revocation always wins across replicas; merges never grant authority | `lib/fortress-core/src/crdt.ts` |
| I9 | Startup, verification and recovery never require network access or Solana | gates G02, P5-2 |
| I10 | A restore never overwrites live data; it stages a verified copy | `routes/fortress/core.ts` (plan → confirm → stage) |

## 3. Flask/SQLite design → this stack

| Source design (Flask/SQLite) | This project |
|---|---|
| `fortress/core/*.py` (canonical, chain, checkpoint, genesis) | `lib/fortress-core` — framework-free TypeScript package, no Express/DB imports |
| `fortress/crypto/*` (envelope, keys, signatures, recovery_codes) | `lib/fortress-core/src/envelope.ts`, `signatures.ts`, `recoveryCodes.ts`; server key handling in `artifacts/api-server/src/fortress/keys.ts` |
| `verifier/verify_chain.py` | `lib/fortress-core/src/cli/verify.ts`, bundled to a single dependency-free `dist/offline-verifier/pfr-verify.mjs` (`pnpm --filter @workspace/fortress-core run build:verifier`) |
| SQLite `BEGIN IMMEDIATE` | PostgreSQL transaction with `SELECT … FOR UPDATE` on the tenant head row; `(tenant_id, idx)` unique |
| Durable idempotency table | `fortress_operations` keyed by tenant + route + key hash, with a request fingerprint (mismatch → `IDEMPOTENCY_CONFLICT`) |
| Transactional outbox + JSONL export | `fortress_outbox` written in the same transaction; `fortress/outbox.ts` appends + fsyncs per-tenant JSONL, repairs a torn last line, rebuilds a missing archive |
| `/health` | `/api/healthz` (liveness, always 200 while the process runs) and `/api/readyz` (readiness: 200 `ready`, 503 `NOT_READY` or `RECOVERY_REQUIRED`) |
| Flask session + default secret | Clerk sessions (proxied, same-origin) behind an `AuthProvider` interface; local `sessions_not_before` cutoff plus Clerk API session revocation behind a `SessionRevoker` interface |
| WebAuthn/passkey enrollment | Delegated to Clerk (passkeys/MFA are configured in the Clerk tenant). Fortress adds saved offline recovery codes and contact recovery on top. |
| Socket.IO events | Not used. In-app notifications are polled via REST and store only message IDs + variables. |
| Permissive CORS | No CORS middleware at all; the web app and API share one origin. |
| `translations/` | `lib/fortress-core/src/messages.ts` — English and Spanish catalogs keyed by message ID, checked for identical placeholders |
| `adapters/jsonld.py`, `crdt.py`, `solana.py` | `lib/fortress-core/src/adapters/jsonld.ts`, `seamcraft.ts`, `solana.ts`, `crdt.ts` |
| `requirements.lock` + offline wheels | `pnpm-lock.yaml` (integrity hashes for every transitive dependency); the offline verifier is a single bundled file with no dependencies |
| Per-installation SQLite file | One PostgreSQL database; each user gets a tenant with its own chain (`chain_id = pf:<hash(installation, trust key)>/<tenant>`) |

## 4. Components

```
lib/fortress-core          framework-free core (also used by the offline verifier)
lib/db/src/schema/fortress.ts   PostgreSQL schema (fortress_* tables)
lib/api-spec/openapi.yaml  contract → generated zod (server) + React Query hooks (web)
artifacts/api-server       Express app: createApp({authProvider, sessionRevoker})
  src/fortress/            keys, tx, ledger, integrity, outbox, vault, auth, gates …
  src/routes/fortress/     core, recovery, protection, credentials, resilience, interop, diagnostics
  tests/                   acceptance suite against the fortress_test database
artifacts/phoenix-fortress admin web app (React + Vite + Clerk)
```

### 4.1 Keys

| Key | Origin | Stored as | Purpose |
|---|---|---|---|
| KEK (`BACKUP_ENCRYPTION_KEY`) | Replit secret, 32 bytes (64 hex chars or base64) | never stored by Fortress | wraps each tenant's recovery-key escrow; HKDF root for derived keys |
| Checkpoint signing key | HKDF(KEK, "checkpoint-signing") or `FORTRESS_SIGNING_SEED` | never stored; public key pinned in `fortress_installation` | signs checkpoints and `.pfr` manifests |
| Recovery-code pepper | HKDF(KEK, "recovery-code-pepper") | never stored | HMAC of saved recovery codes |
| Recovery key | random 32 bytes per tenant, shown once | wrapped by KEK | wraps every per-item data key |
| Data keys | random per backup/evidence item | wrapped by the recovery key | AES-256-GCM of content |
| Extraction / ingest credentials | random `pf_…` tokens | SHA-256 hash only | export (≤15 min, read one backup) or ingest (write-only, ≤90 days) |

If the pinned trust key no longer matches the configured key, readiness reports
`RECOVERY_REQUIRED` (`TRUST_KEY_MISMATCH`) instead of silently re-keying.

### 4.2 Ledger

Block fields: `v, idx, event_id (UUIDv7), occurred_at_us, event_type,
actor_id, object_ref, prev_hash, idempotency_key_hash, meta, hash`. Genesis is a
pure function of the manifest (no clock, no randomness). Verification rejects
index gaps, predecessor mismatches, payload mutation, unsupported block or
canonicalization versions, and checkpoint contradictions.

### 4.3 Recovery package (`.pfr`)

A POSIX tar with `manifest.json` + `manifest.sig`, `ledger/manifest.json`,
`ledger/blocks.jsonl`, `ledger/checkpoint.json|.sig`, `vault/backups.enc`,
`vault/evidence.enc` and a bilingual `VERIFY.txt`. The offline verifier checks
the signature against a pinned trust key, every file hash, the chain, the
checkpoint, and that every vault item is committed in the ledger. With the
recovery key it decrypts into a new, empty directory only.

## 5. Phases

### Phase 1 — MVP
Core package; atomic idempotent commits; outbox → JSONL; liveness/readiness;
fail-closed startup verification; signed checkpoints; `.pfr` packages and the
offline verifier; saved recovery codes (10 × 100-bit, HMAC-stored, single use,
throttled); emergency recovery that revokes all other sessions and every
credential and issues a replacement recovery key; restore plan → typed
confirmation → staged copy → rollback.

### Phase 2 — Protection
Recovery contacts (consent-gated), quorum threshold ≤ active contacts, minimum
24-hour delay, owner cancel, approvals from removed contacts stop counting,
contacts never gain tenant access and are never notified when removed. Consent
registry with seven purposes, nothing pre-granted. Opt-in encrypted evidence
with crypto-shredding on delete (labels never enter the ledger). In-app-only
notification policy with `suppressed` mode. Safe Recovery mode (hides notices,
neutral UI) and Quick Exit. English and Spanish message IDs.

### Phase 3 — Resilience
Trusted signer registry (peer, witness, Seamcraft sender). Witness
countersignatures on local checkpoints; countersigning registered peers'
checkpoints. External checkpoint import: consistent → recorded; contradicting or
ahead-of-tip → integrity condition, `RECOVERY_REQUIRED`. Revocation-only CRDT
(tombstones for credentials, contacts, consents, signers) whose merge is
commutative, associative, idempotent and can only revoke.

### Phase 4 — Interoperability
Adapters run through one pipeline: validate → authorize (consent + trust) →
canonicalize → atomic commit. JSON-LD uses RDFC-1.0 (`jsonld@9`) with bundled
contexts only; remote contexts are blocked. Seamcraft is a **provisional**
envelope (`0.1-provisional`, no public spec was available): signed sender,
recipient bound to the tenant chain, 5-minute skew, persistent nonce store,
64 KiB limit. JUSCR integrates through the REST API with a write-only ingest
credential (`POST /api/v1/ingest/backups`, idempotent) — see `OPERATIONS.md`.

### Phase 5 — External proof
Optional Solana anchors. The commitment is only `{chain_ref (sha256 of the
chain id), height, tip_hash, checkpoint_hash}`; the memo is checked to contain
nothing else. Requires the `external_anchor` consent. Fortress has no Solana
network code: the operator writes the memo with their own wallet and records the
transaction signature, which is stored as `recorded_unverified`. Startup,
verification and recovery never touch the chain.

## 6. Acceptance gates

Gate definitions live in `artifacts/api-server/src/fortress/gates.ts`; tests
prove a gate by carrying `[GateID]` in their name. The diagnostics page shows
each gate as passed / failed / stale (code changed since the run) / not run /
manual, plus three live gates (readiness, encryption key, pinned trust key).

| Gate | Requirement |
|---|---|
| G01 | Fresh installation → deterministic expected genesis |
| G02 | Offline boot → READY without network access |
| G03 | Tampered block → fails closed |
| G04 | Rewritten ledger → trusted checkpoint contradiction |
| G05 | 100 concurrent commits → no duplicate idx, no lost block |
| G06 | Request replay → no second mutation |
| G07 | Crash before archive export → outbox resumes |
| G08 | Lost device → saved recovery code restores control |
| G09 | Stolen device → sessions and credentials revoked |
| G10 | Ransomware drill → offline `.pfr` verifies and restores |
| G11 | Bad backup → restoration rejected |
| G12 | Secret scan → no plaintext protected secret at rest |
| G13 | Accessibility review (manual, non-critical) |
| G14 | Safe mode → no covert tracking or forced disclosure |
| P2-1…P2-4 | Contacts/quorum/delay, consent, evidence, en/es catalog |
| P3-1…P3-3 | Witnesses, checkpoint import, revocation CRDT |
| P4-1…P4-3 | JSON-LD RDFC-1.0, Seamcraft, JUSCR ingest |
| P5-1, P5-2 | Non-personal consented anchors; Solana never required |

The app is **publishable** only when readiness is `ready` and every critical
gate has fresh passing evidence. `productionVerified` is always `false` in
diagnostics: passing tests in development does not prove the published
environment; see `PRODUCTION.md`.

## 7. Deliberate deviations from the source document

- **Authenticators:** WebAuthn/passkeys are provided by Clerk rather than a
  bespoke implementation; Fortress cannot list or revoke individual Clerk
  authenticators, but it revokes all Clerk sessions and enforces a local session
  cutoff.
- **Storage:** PostgreSQL replaces SQLite. Replit's filesystem is not durable in
  deployments, so the JSONL archive is a secondary export; `.pfr` packages
  downloaded by the owner are the off-platform survival copy.
- **Seamcraft:** provisional envelope format, to be replaced when a published
  specification exists.
- **Solana:** record-only; no on-chain verification inside Fortress.
- **Socket.IO:** not used.
