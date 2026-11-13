# Repository Integration Roadmap

**Purpose:** Build a verifiable path from the independent Lost Legacies Live projects to a coherent ecosystem without destroying project boundaries.

## Phase 0 — Establish the portfolio repository

**Deliverables**
- Central README and documentation index.
- Architecture decisions and integration roadmap.
- Preserved source specifications and investor material.
- Explicit labels for implemented, reported, proposed, and unverified work.

**Exit criteria**
- Main branch is initialized.
- Source-of-origin links are recorded.
- Existing product repositories remain unchanged.

## Phase 1 — Repository and deployment inventory

For each candidate project, record:
- Exact GitHub owner/repository URL and default branch.
- Active development branches and latest relevant commits.
- Replit workspace/deployment URL and deployment type, where applicable.
- Framework, language, build commands, entry points, tests, and package manifests.
- Backend services, database, authentication, storage, queues, and external APIs.
- Required secrets by name only (never copy secret values).
- Current data ownership, license, maintainers, and release process.
- Staging/production status supported by direct evidence.

Start with the known portfolio groupings: JUSCR Unified Living Ecosystem; Phoenix Flies / PhoenixflyLive; TimeAuction; Karen Kuality Kontrol / KarenQuestThroughoutV; JUSCR-FreeForAll / community projects; and JustUsScoolCocreatingReality / 2foreachofu. Also map Archon Fracture Back, Time Engine, Spine Alignment, Ouroboros Ward, Secret Rooms, Phoenix Fortress, and community-voted projects to their actual repositories rather than guessing URLs.

**Exit criteria:** A repository register with verified links, branch names, deployment status, ownership, and confidence labels.

## Phase 2 — Define shared contracts

Design and review:
- Project and tenant identifiers/namespaces.
- Identity mapping and authorization boundaries.
- API schemas and versioning.
- Event envelope and delivery semantics.
- Idempotency keys, duplicate handling, and replay protection.
- Data classification, consent, retention, export, and deletion.
- Audit and integrity requirements.

Use JSON-LD/RDF or CloudEvents only where they solve a documented interoperability need. Define compatibility and security semantics rather than treating a schema format as a complete integration.

**Exit criteria:** Versioned contracts, examples, compatibility tests, and an agreed ownership model.

## Phase 3 — Build a thin integration layer

- Keep each product's UI and core domain logic in its own repository.
- Add narrowly scoped adapters for shared identity, navigation, APIs, and event exchange.
- Preserve project-specific data stores until migration is justified and tested.
- Avoid dual writes without an explicit consistency strategy.
- Use idempotency for retryable operations that must not be duplicated.
- Keep secrets server-side and use least-privilege service credentials.

The investor materials report Fastify/PostgreSQL interoperability work as an existing track, while Supabase/Solana/Redis and local-first/CRDT capabilities are proposed tracks. Validate both against code before choosing the integration target.

**Exit criteria:** One end-to-end cross-project workflow works in a test environment with authorization, retries, observability, and rollback demonstrated.

## Phase 4 — Time Engine integration

Use the existing specification as the source-of-origin design artifact:
- Repository: `JUSCR-FreeForAll/archonfractureback`
- Branch: `codex/six-segment-interoperability`
- Design commit: `6d126e8f63ee`
- File: `docs/time/energy-economy-engine-insertion.md`

Preserve the design's six-position choice matrix and dual zeros, Earth Realms 1–4 and positive/negative boundaries, Ouroboros and perpendicular tarot paths, Half-Positive and Half-Negative archetypes, Secret Rooms, engine insertion sequence, legacy rewrites, and Realm 3/4 expansion gates.

**Release gates**
- Prototype remains private and reversible.
- Secret Rooms remain protected individual workspaces.
- No sharing, financial activity, or external deployment without separate authorization.
- Privacy, consent, security, and technical acceptance criteria are tested.
- Any financial or on-chain functionality receives a separate threat model, authorization review, and test plan.

**Exit criteria:** A private, non-financial prototype passes acceptance tests and has a documented rollback procedure.

## Phase 5 — Product-specific web and mobile integration

For each product:
- Keep its standalone entry point and deployment.
- Add shared navigation or launcher links only after product owner approval.
- Integrate APIs through documented contracts.
- Verify mobile layouts, authentication boundaries, deep links, and offline/error states.
- Track product-specific release and rollback procedures.

**Exit criteria:** Each connected product remains independently operable and the shared user journey passes end-to-end tests.

## Phase 6 — Verification and release

Run, record, and retain:
- Unit, integration, contract, and end-to-end tests.
- Reproducible production builds.
- Dependency and secret scans.
- Authorization and tenant-isolation tests.
- Read-only staging health and migration checks.
- Backup/restore and rollback exercises.
- Performance benchmarks for any claimed efficiency gains.

Only promote a feature when the exact commit, environment, migration state, test evidence, and rollback path are known.

## Current cautions

- The Sovereign Circuit executive summary describes an inaccessible workspace and infers a static front end from the public deployment address; it does not verify that project's source tree or backend.
- The Phase 1 Hybrid Build roadmap is an original plan dated July 2026; its student counts and August 1, 2026 launch instructions are historical plan details, not current status.
- Investor funding, revenue, savings, compliance, and customer targets in the supplied materials are aspirations or research claims until independently evidenced.
- The existing Time Engine design commit is real according to the supplied commit record and repository fetch; it does not establish that the engine is implemented or deployed.

## Working rule

Every integration PR should state: source repositories and commits, files changed, contract version, data touched, tests run, staging evidence, security/privacy impact, rollback steps, and explicit approvals required.
