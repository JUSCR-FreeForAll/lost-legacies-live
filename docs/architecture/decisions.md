# Architecture Decisions

**Status:** Baseline decisions for repository coordination. This document records the boundaries stated in the supplied portfolio and technical materials; it does not certify a production architecture.

## AD-001 — Keep products independently deployable

**Decision:** Lost Legacies Live is the portfolio and coordination layer. Product repositories remain independently owned and deployable.

**Reason:** The investor strategy explicitly distinguishes a shared ecosystem from forcing all projects into one application or one database schema.

**Consequences:**
- Use adapters, APIs, and documented events to connect products.
- Keep product-specific data and release cycles isolated.
- Do not bulk-copy source trees or rewrite project histories into this repository.
- Any future source-code migration requires a separate plan, ownership check, tests, and rollback path.

## AD-002 — Treat the current backend and proposed infrastructure as separate tracks

**Existing/reported track:** The investor materials describe Fastify and PostgreSQL integration work in `archonfractureback`, with JSON-LD, CloudEvents, SHA-256 integrity primitives, and namespaced storage. They also state that the separate Express/Clerk/Postgres JUSCR web consumer had not yet been connected to the Fastify backend.

**Proposed track:** The Phase 1 roadmap proposes Supabase/PostgreSQL, a Solana Anchor program, Redis idempotency ("Ouroboros Ward"), and a Glide front end. The investor materials separately propose SQLite/CRDT local-first synchronization, MCP/AI, JSON-LD/RDF, audit, and identity capabilities.

**Decision:** Do not present these stacks as one integrated, deployed architecture until code, configuration, data flow, and tests prove the connection. Select an implementation path per capability after repository inspection.

## AD-003 — Use explicit interoperability contracts

Candidate shared contract elements described in the supplied materials:
- Project-scoped namespaces and stable identifiers.
- Versioned HTTP/API contracts.
- CloudEvents-style event envelopes where event exchange is required.
- JSON-LD/RDF semantic descriptions where cross-project meaning must be shared.
- SHA-256 hashes for integrity evidence where appropriate.

Before implementation, define ownership, schema versioning, compatibility rules, authorization, retry behavior, idempotency, and retention for every shared contract. A format choice alone does not provide security or interoperability.

## AD-004 — Make privacy, consent, and reversibility release gates

The Time Engine design record specifies Secret Rooms as protected individual workspaces and states that the first engine prototype remains private and reversible. Sharing, financial activity, and external deployment each require separate authorization.

**Decision:** Treat those boundaries as mandatory. Default new prototypes to private, minimize data collection, enforce least privilege, and make external sharing or financial operations explicit opt-ins with auditable authorization. Do not enable financial actions as part of a documentation or integration commit.

## AD-005 — Keep identity and data boundaries explicit

Before connecting products, document:
- Which system is authoritative for user identity.
- Whether identities are linked or merely mapped across products.
- Project/tenant ownership of every record.
- Consent and purpose for cross-project data use.
- Data deletion, export, retention, and audit behavior.
- Service-to-service authentication and secret storage.

No shared identity provider or cross-product data-sharing permission is assumed by this repository.

## AD-006 — Evidence before readiness claims

Use the following evidence hierarchy:
1. Source code and committed configuration.
2. Automated test results and reproducible build output.
3. Staging deployment and read-only health checks.
4. Production deployment and operational telemetry.
5. Customer, revenue, compliance, or performance evidence.

A roadmap, investor target, inferred Replit deployment type, or reported prototype is not evidence of a completed production capability. The Sovereign Circuit assessment is explicitly inferential because the underlying source workspace was inaccessible during that assessment.

## Open decisions

- Canonical identity and authorization model.
- Shared API gateway versus product-owned APIs.
- PostgreSQL/Fastify baseline versus Supabase adoption and migration path.
- Whether Solana is required for any production workflow and which actions, if any, may be on-chain.
- Redis deployment and idempotency retention policy.
- Local-first/CRDT synchronization technology and conflict semantics.
- Common observability, audit, backup, and disaster-recovery requirements.
- Product-by-product data classification and privacy review.

Resolve these decisions through small architecture proposals backed by repository evidence, not by assuming every proposed component is mandatory.
