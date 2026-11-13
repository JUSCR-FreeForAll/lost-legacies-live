# ADR-001: Lost Legacies Live as Integration Home

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** Jordan Timothy Eckstrom

## Context

Multiple independent repositories (`archonfractureback`, `JUSCR-FreeForAll`, `JusticeWithinUs`, `buzz`, and private repositories) and live Replit prototypes (`JUSCR Unified`, `Sovereign Circuit`, `Five Realms`, `Phoenix Flies`) exist across the ecosystem. Without a central coordination repository, shared schemas can drift and prototype code risks being lost or tightly coupled.

## Decision

- `lost-legacies-live` is the canonical integration monorepo for shared contracts, cross-app navigation, and staged service/app composition.
- `archonfractureback` remains the backend authority for JUSCR Spine, consent enforcement, Secret Rooms, and the Time Engine until stabilized and extracted.
- `JUSCR-FreeForAll` remains the canon, curriculum, and AllTimeContract documentation authority.
- `buzz` remains an independent repository due to its scale and distinct Nostr/Rust identity model.
- Replit workspaces serve as rapid prototypes or hosting targets; GitHub is the source of truth.

## Consequences

- **Positive:** Establishes a single home for shared TypeScript contracts and CI hygiene without requiring a big-bang merge.
- **Negative / Trade-offs:** Requires disciplined source mapping from Replit to GitHub and explicit versioning across service boundaries.
- **Follow-up Actions:** Complete the Phase 0 CI baseline, reconcile `codex/six-segment-interoperability` in `archonfractureback`, and map all Replit workspaces in `docs/migration/00-inventory.md`.
