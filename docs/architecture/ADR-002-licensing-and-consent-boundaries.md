# ADR-002: Licensing Firewall and Consent Boundaries

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** Jordan Timothy Eckstrom

## Context

`JUSCR-FreeForAll` is identified in project materials as AGPL-licensed, while `lost-legacies-live` coordinates modular apps, shared domain packages, and privacy-critical subsystems (Secret Rooms and Time Engine). Copying AGPL code into shared libraries without a boundary policy creates licensing risks, and mixing symbolic Time Engine coordinates with transactional Time Auction ledgers creates data-leakage risks.

## Decision

1. **License firewall:** No code from `JUSCR-FreeForAll` may be copied into `packages/` or `apps/` without an explicit licensing review recorded in `docs/rights/`. Shared schemas in `packages/contracts` will be authored cleanly to preserve modular licensing options.
2. **Ledger separation:** Time Auction (transactional hours ledger) and Time Engine (symbolic time coordinates and private reflection) remain separate services and data stores.
3. **Private by default:** Secret Rooms require explicit opt-in consent, verifiable provenance metadata, and cryptographic key isolation before any cross-segment read is permitted.

## Consequences

- **Positive:** Establishes review gates for licensing and privacy-sensitive data flows.
- **Negative / Trade-offs:** Adds upfront work to define cross-service DTOs and record licensing decisions.
- **Follow-up Actions:** Audit the `codex/six-segment-interoperability` consent helpers during Phase 1 before exposing Time Engine endpoints.

## Verification note

This ADR records the supplied project position; it is not a legal opinion or an independent verification of the current license files. Confirm the exact license and applicable obligations before copying or distributing code.
