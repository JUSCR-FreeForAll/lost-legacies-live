# Lost Legacies Live — Phase 0–6 Integration Checklist

**Working branch:** `integration/phase-0-1-foundation`  
**Coordination repository:** `JUSCR-FreeForAll/lost-legacies-live`  
**Rule:** Preserve source repositories and deployments. Integrate only after repository, license, data, and security boundaries are understood.

Status key: `[ ]` not started · `[x]` evidenced complete · `[~]` in progress · `[?]` requires verification.

## Phase 0A — Repository baseline and governance

- [x] Confirm central repository and default branch (`main`).
- [x] Preserve existing README, architecture decisions, integration roadmap, and Time Engine design record.
- [x] Create a dedicated integration branch rather than writing directly to `main`.
- [ ] Review and merge this foundation PR after maintainer approval.
- [ ] Confirm authority to apply Apache-2.0 to original repository contributions; review exclusions in LICENSE and NOTICE.
- [ ] Verify source licenses and provenance for all mirrored material.
- [ ] Add `.env.example` only after required variable names are verified; never include secret values.
- [ ] Add repository CODEOWNERS and contribution guidance.
- [ ] Add baseline CI and ensure the workspace lockfile is reproducible.
- [ ] Create/update `docs/inventory/repository-register.md` with verified repository URLs, branches, deployment links, owners, licenses, and confidence labels.

**Exit gate:** A reviewable baseline exists, licensing scope is understood, and no source repository has been overwritten or merged wholesale.

## Phase 0B — Private Secret-Room Safety Gate (required before expansion)

Repository setup, the root license, scaffold CI, and a private default do not establish this gate. Track implementation and all 12 charter criteria in [safety-gate issue #2](https://github.com/JUSCR-FreeForAll/lost-legacies-live/issues/2).

- [x] Locate the full Secret-Room charter and bounded implementation on archonfractureback, interoperability revision aef79ce71bd282b1d2104da6316af35aab63ac33. This is source verification only, not test execution.
- [ ] Record the current Replit project revision separately and reconcile only the bounded module; preserve existing persistence, validation and queued work.
- [ ] Enforce private/local-only states in application policy and database constraints; use a forward migration for already-applied schemas and test only disposable databases.
- [ ] Establish authenticated participant ownership before accepting persistent sensitive contributions; verify encryption-key generation, access, recovery and revocation behavior.
- [ ] Enforce consent purpose, principal, resource, audience, expiry and revocation, including idempotent retries and changed-operation attempts.
- [ ] Preserve original writing with recoverable revisions and owner-only completion; keep completion qualitative and non-financial.
- [ ] Keep sharing, invitations, public discovery, payments, tokens, external-service calls and delivery workers unavailable in the private core.
- [ ] Map all 12 charter criteria to tests. For later collaboration criteria, prove refusal now and explicitly defer positive collaboration tests; do not implement sharing just to satisfy a future criterion.
- [ ] Run the TypeScript build, relevant unit/security tests and real disposable-PostgreSQL integration tests. Record commands, exact revisions, pass/fail/skip counts and remaining limitations. Mocked database tests and skipped suites are not database-security proof.
- [ ] Keep the gate open until evidence is recorded. No automatic merge, deployment or production migration is authorized.

**Exit gate:** Evidence demonstrates the private, reversible, participant-owned core. Cross-project synchronization, package extraction, collaboration, auctions and economy expansion remain deferred until this gate passes and their own permissions and release gates are satisfied.

## Phase 1 — Spine / Time Engine reconciliation

### Archon Fracture Back source review
- [ ] Confirm `JUSCR-FreeForAll/archonfractureback` current default branch and all active branches.
- [x] Compare `workit` with `codex/six-segment-interoperability`: GitHub comparison reports 41 commits ahead, 0 behind, and 39 changed files as of 2026-11-13. This is comparison metadata, not a code review or test result.
- [ ] Review the reported 41+ interoperability commits individually or by coherent commit groups; verify the actual count rather than assuming it.
- [ ] Inspect auth, identity, tenant/project namespaces, data model, migrations, API routes, event formats, and secret handling.
- [ ] Confirm the existing Fastify/PostgreSQL track against source code. Do not conflate it with the proposed Supabase/Solana/Redis stack.
- [x] Inspect the JUSCR-FreForAll root LICENSE: it is placeholder text referring to AGPL-3.0, not the full license. Treat exact terms as unresolved and do not copy code until corrected and reviewed.
- [ ] Verify the current license and provenance of Archon Fracture Back and each file before copying or adapting any source.
- [ ] Open a source-repository PR for any required branch reconciliation; do not merge it from this portfolio repository.

### Time Engine / Spine safety and database
- [ ] Inspect the existing Time Engine specification at its source commit: `6d126e8f63ee`.
- [ ] Inspect `db/schema.sql` and `db/migrations/002_time_engine.sql` from the actual source repository before execution.
- [ ] Run migrations only against a disposable PostgreSQL database first; capture before/after schema and rollback behavior.
- [ ] Review authentication, key lifecycle, consent revocation, tenant isolation, public API gating, audit trails, and backup/restore.
- [ ] Keep the first Time Engine prototype private, synthetic-data-first, non-financial, and reversible.
- [ ] Test that Secret Rooms cannot be read by other users or projects.
- [ ] Test that private exercises cannot trigger external messages, publication, payments, token issuance, or blockchain transactions.
- [ ] Record a rollback procedure and security acceptance evidence.

### Integration decision
- [ ] Decide whether Archon Fracture Back remains a submodule under `services/juscr-spine` or is consumed through a service/API boundary.
- [ ] Extract only clean, provenance-cleared packages. Candidate first packages: `packages/contracts` and `packages/time-model`.
- [ ] Move to pnpm workspaces when the first shared package is actually extracted; the root workspace starter is provided in this PR.
- [ ] Keep product-specific code and histories in their source repositories.
- [ ] Update repository register and architecture decisions with exact source commit references.

**Exit gate:** A private, non-financial, independently testable prototype and a documented integration boundary exist. No production deployment is implied.

## Phase 2 — Identity, contracts, and provenance

- [ ] Define canonical project and tenant identifiers; do not assume one global database or identity provider.
- [ ] Define identity mapping between products, including issuer, subject, linking consent, unlinking, and account recovery.
- [ ] Specify authentication separately from authorization; define roles, scopes, resource ownership, and service-to-service credentials.
- [ ] Define API schemas, versioning, compatibility rules, error semantics, pagination, and deprecation policy.
- [ ] Define event envelope, delivery guarantees, ordering expectations, retries, replay protection, and idempotency.
- [ ] Define consent purpose, scope, expiry, revocation, and evidence.
- [ ] Define data classification, minimization, retention, export, deletion, and audit access.
- [ ] Define provenance fields distinguishing original, quote, relay, summary, and interpretation; do not treat labels or writing style as authentication.
- [ ] Add contract fixtures and compatibility tests.
- [ ] Obtain review from product owners and privacy/security reviewers.

**Exit gate:** Versioned contracts, examples, compatibility tests, and an agreed data/identity ownership model are approved.

## Phase 3 — Thin integration layer

- [ ] Choose one bounded cross-project use case with a clear user benefit.
- [ ] Implement a narrow adapter or API client; avoid shared-database coupling.
- [ ] Enforce tenant/project authorization at every service boundary.
- [ ] Keep secrets server-side and use least-privilege credentials.
- [ ] Add idempotency only to operations that can be retried; define key scope, retention, result replay, and failure recovery.
- [ ] Add correlation IDs, structured logs, metrics, and audit events without logging sensitive payloads.
- [ ] Avoid dual writes unless an explicit consistency and repair strategy exists.
- [ ] Test timeout, retry, duplicate, partial failure, revocation, and unauthorized access paths.
- [ ] Demonstrate the workflow in a non-production environment and document rollback.

**Exit gate:** One end-to-end workflow passes contract, authorization, failure, and rollback tests.

## Phase 4 — Time Engine and realm expansion

- [ ] Preserve the six-position matrix and dual-zero model as specified; do not invent semantics for the unresolved additional zero realm.
- [ ] Keep participant-authored domain boundaries and distinguish observations, interpretations, and unknowns.
- [ ] Keep Half-Positive and Half-Negative as optional review lenses, not autonomous external agents.
- [ ] Keep Secret Rooms private and participant-controlled.
- [ ] Require explicit, purpose-specific, revocable consent before any sharing action.
- [ ] Keep Realm 3 publication and Realm 4 scaling behind separate governance and safety gates.
- [ ] Treat symbolic energy as non-monetary unless separately reviewed and authorized.
- [ ] Require legal, tax, consumer-protection, security, and governance review before any real payments, credits, tokens, investment, or transfers.
- [ ] Test privacy, provenance, consent, data deletion, and no-external-action guarantees.

**Exit gate:** Private prototype acceptance is demonstrated; no financial or public release is inferred from design completion.

## Phase 5 — Product-specific web, mobile, and Replit mapping

- [ ] Complete the Replit source/deployment register using `docs/integration/replit-source-mapping.md`.
- [ ] Verify each workspace and deployment directly; do not infer source structure from a public URL alone.
- [ ] Map JUSCR Unified Living Ecosystem, Phoenix Flies / PhoenixflyLive, TimeAuction, Karen Kuality Kontrol / KarenQuestThroughoutV, JUSCR-FreForAll/community projects, and JustUsScoolCocreatingReality / 2foreachofu.
- [ ] Map additional named initiatives (Spine Alignment, Ouroboros Ward, Secret Rooms, Phoenix Fortress, Time Engine, community-voted projects) to verified source repositories and owners.
- [ ] Preserve each product's standalone entry point, audience, release cycle, and deployment.
- [ ] Add shared navigation/launcher links only with product-owner approval.
- [ ] Test mobile layouts, deep links, authentication isolation, offline/error states, and accessibility.
- [ ] Record deployment target, build command, output directory, environment requirements, and rollback for each app.

**Exit gate:** Every linked product remains independently operable and the integrated user journey passes end-to-end tests.

## Phase 6 — Verification and release

- [ ] Run unit, integration, contract, and end-to-end tests.
- [ ] Produce reproducible builds from a clean checkout.
- [ ] Run dependency, secret, and license scans.
- [ ] Test authorization, tenant isolation, consent revocation, and data deletion.
- [ ] Verify staging health and deployed revision against the intended branch/commit.
- [ ] Verify database migration state with read-only checks where possible.
- [ ] Exercise backup/restore and rollback.
- [ ] Benchmark any performance or cost-saving claims against a documented baseline.
- [ ] Attach evidence to the release PR: exact commits, environments, tests, migration state, security review, and approvals.
- [ ] Promote only after explicit release approval.

**Exit gate:** A release candidate has traceable evidence, an owner, an operational runbook, and a tested rollback.

## Cross-phase rules

- Never commit secrets, private keys, production credentials, participant personal data, or unredacted logs.
- Never infer repository URLs, branches, licenses, deployment types, or readiness.
- Keep reported, proposed, inferred, and verified status distinct.
- Neither repository creation nor passing empty-workspace CI is completion of the private-core safety gate.
- Directory, package and service separation do not automatically resolve licensing obligations; verify provenance and terms before extraction.
- Do not merge product source trees into this portfolio repository by default.
- A documentation commit does not authorize deployment, data sharing, publication, or financial activity.
