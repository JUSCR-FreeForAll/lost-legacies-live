# Lost Legacies Live — Full Integration Checklist

**Last updated:** 2026-11-13  
**Target repository:** https://github.com/JUSCR-FreeForAll/lost-legacies-live

## Phase 0 — Safe Baseline
- [ ] Confirm the existing repository and branch; preserve existing history.
- [ ] Confirm directory structure: `apps/`, `services/`, `packages/`, `docs/{architecture,charters,integrations,migration,rights}/`, and `tests/{integration,security,e2e}/`.
- [ ] Maintain the root `README.md`.
- [ ] Add root `LICENSE` (Apache-2.0) and `NOTICE`.
- [ ] Maintain ADR-001: Integration Home.
- [ ] Maintain ADR-002: Licensing and Consent Boundaries.
- [ ] Maintain `.env.example` with placeholders only; never commit real secrets.
- [ ] Maintain GitHub Actions CI for secret scanning, lint, typecheck, build, and tests.
- [ ] Maintain `docs/migration/00-inventory.md` with live verification notes.
- [ ] Confirm repository visibility, branch protections, and absence of secrets.

## Phase 1 — Spine / Time Engine Reconciliation
- [ ] Review `archonfractureback` and identify its authoritative branch and current revision.
- [ ] Diff `workit` against `codex/six-segment-interoperability`.
- [ ] Review the interoperability branch commits and record the reviewed range.
- [ ] Open a pull request from the interoperability branch to the agreed stable branch.
- [ ] Run existing tests before extraction.
- [ ] Apply migrations only to a disposable PostgreSQL database:
  - [ ] `db/schema.sql` first.
  - [ ] Then `db/migrations/002_time_engine.sql`.
- [ ] Review authentication, encryption-key lifecycle, consent revocation, and public API gating.
- [ ] Record the decision to retain the subsystem as a separate repository/submodule or extract it.
- [ ] Extract `packages/time-model` only after source provenance and tests are established.
- [ ] Extract `packages/contracts` for shared event and identity types only after contract review.
- [ ] Integrate the extracted packages through the existing pnpm workspace.
- [ ] Update `ECOSYSTEM.md` and `manifest.json` references where those files exist.
- [ ] Document Time Engine activation gates; do not expose public endpoints until authentication, authorization, key management, and consent-revocation tests pass.

## Phase 2 — Shared Identity, Contracts & Source Mapping
- [ ] Decide the identity approach (Better Auth or another provider) and record it in an ADR.
- [ ] Define a shared event envelope covering id, provenance, consent, protocol, outcome, and status.
- [ ] Map every Replit workspace to a GitHub remote or explicitly archive it.
- [ ] Inventory JUSCR Unified Living Ecosystem.
- [ ] Inventory Sovereign Circuit.
- [ ] Inventory Five Realms Adventure.
- [ ] Inventory Phoenix Flies.
- [ ] Inventory investor presentation and supporting materials.
- [ ] Inventory other workspaces and repositories without guessing missing URLs.
- [ ] Create `packages/realm-model` and `packages/provenance` only after their contracts are approved.
- [ ] Add CI type-checking across packages.
- [ ] Audit licenses and provenance before copying code; do not allow accidental AGPL-derived code into permissively licensed packages.

## Phase 3 — First Apps & Services
- [ ] Integrate Time Auction (hours ledger) as an independent service; keep it separate from the symbolic Time Engine.
- [ ] Extract the Five Realms choice model into `packages/choice-engine` only after source review.
- [ ] Build the `apps/portal` navigation shell.
- [ ] Build the `apps/five-realms` application shell.
- [ ] Skeleton Karen Quest / two4eachofu under `apps/` only where rights and private status permit.
- [ ] Document Phoenix Fortress and Ward boundaries.
- [ ] Keep Secret Rooms private by default, with explicit consent and access boundaries.

## Phase 4 — Governance & Hardening
- [ ] Build a community-voting backend as a new service; do not merge fragmented counters without reconciliation.
- [ ] Define role and rights model for Phoenix Gate / stewardship.
- [ ] Add end-to-end consent and audit tests.
- [ ] Implement and review encryption-key lifecycle.
- [ ] Complete production deployment checklist and secrets management.
- [ ] Document disaster recovery and perform backup/restore drills.

## Ongoing Gates (never skip)
- [ ] No public Time Engine endpoints until authentication, authorization, encryption, and consent-revocation tests pass.
- [ ] Replit remains a prototype/deployment surface; GitHub is the source of truth.
- [ ] Buzz stays independent.
- [ ] Preserve license notices and source provenance.
- [ ] Do not merge independent application histories as part of routine integration.
- [ ] Mark implementation status as implemented, reported, proposed, or unverified; do not present plans as completed work.
