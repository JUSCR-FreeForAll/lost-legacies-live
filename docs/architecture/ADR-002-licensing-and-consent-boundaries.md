# ADR-002: Licensing Firewall and Consent Boundaries

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** Project maintainers

## Context

The Lost Legacies Live integration repository coordinates modular applications, shared domain packages, and privacy-sensitive subsystems. Project materials identify `JUSCR-FreeForAll` as AGPL-licensed, while this repository is intended to provide reusable contracts and integration components under a permissive license.

Copying AGPL code into shared libraries without a provenance and licensing review can create obligations that are incompatible with the intended reuse model. Separately, mixing the transactional Time Auction ledger with symbolic Time Engine records creates data-boundary and privacy risks.

## Decision

1. **Repository default:** The default license for original material in `lost-legacies-live` is Apache License 2.0, subject to file-level third-party notices and documented exceptions.
2. **Shared packages:** Original shared packages such as `packages/contracts`, `packages/time-model`, `packages/realm-model`, `packages/provenance`, `packages/choice-engine`, and `packages/shared-ui` should use Apache-2.0. MIT may be used only when explicitly justified and documented.
3. **AGPL isolation:** AGPL-licensed material must remain in its original repository where practical. Any vendored AGPL material must be isolated under a clearly marked location such as `vendor/agpl/`, retain its original license and notices, and not be represented as Apache-2.0.
4. **No unreviewed derivation:** Code copied or derived from AGPL sources must not enter permissively licensed packages without explicit legal review and a recorded provenance decision in `docs/rights/`. Directory boundaries alone do not determine derivative-work status or resolve licensing obligations.
5. **Contributions:** New contributions to Apache-2.0 packages are offered under Apache-2.0, subject to any separate contributor agreement adopted by the project.
6. **Notices:** The root `LICENSE` applies to original repository material intended to be Apache-2.0. `NOTICE` records relevant attributions and third-party licensing context. Individual files and vendored components may carry their own license terms.
7. **Ledger separation:** Time Auction (transactional hours ledger) and Time Engine (symbolic time coordinates and private reflection) remain separate services and data stores.
8. **Private by default:** Secret Rooms require explicit opt-in consent, verifiable provenance metadata, and cryptographic key isolation before any cross-segment read is permitted.

## Consequences

- Independent applications can consume cleanly authored shared contracts without assuming that unrelated source repositories have the same license.
- Copyleft code and third-party material retain their applicable licenses and notices.
- Licensing review and provenance documentation are required before copying source across repository boundaries.
- Time Auction and Time Engine retain distinct data and authorization boundaries.
- The project must not imply that a license firewall or folder layout alone guarantees legal separation.

## Follow-up Actions

- Audit source provenance before extracting packages from `archonfractureback` or `JUSCR-FreeForAll`.
- Record exceptions and third-party notices in `docs/rights/`.
- Review the Time Engine consent helpers before exposing public endpoints.

## Verification Note

This ADR records the project's intended policy; it is not a legal opinion or an independent verification of the current license files in related repositories. Confirm copyright ownership, contributor rights, source provenance, and applicable license obligations before copying or distributing code.

## References

- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
- Original repository and license notices: https://github.com/JUSCR-FreeForAll/JUSCR-FreForAll
