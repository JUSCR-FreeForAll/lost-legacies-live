# ADR-002 — Licensing policy and provenance boundaries

- **Status:** Proposed for maintainer review; contributor authority and legacy-content review remain open
- **Date:** 2026-11-13
- **Decision owners:** Repository maintainers
- **Supersedes:** None

## Context

Lost Legacies Live coordinates several independent repositories. The supplied project feedback identifies JUSCR-FreForAll as AGPL-licensed. A live inspection of `JUSCR-FreeForAll/JUSCR-FreForAll` on 2026-11-13 found that its root LICENSE contains placeholder text referring to AGPL-3.0 rather than the complete license text. Therefore its intended license is indicated but not properly evidenced by the repository file. Treat the repository as a reciprocal-license candidate and do not copy or adapt its code until the full license and file-level notices are verified. A permissively licensed umbrella repository must not silently absorb code, substantial derived code, assets, or dependencies whose terms are incompatible or not yet understood.

The central repository currently serves as a portfolio index and documentation home. Its existing README states that product repositories remain independent and that integration should occur through contracts and adapters rather than bulk copying.

## Decision

1. **Default for new, original contributions in this repository:** Apache License 2.0, subject to the scope and exclusions in the root LICENSE and NOTICE files.
2. **Shared packages intended for independent reuse:** Apache-2.0 is the preferred default for newly authored packages such as `packages/contracts`, `packages/time-model`, `packages/realm-model`, and `packages/provenance`, once those packages exist and their provenance is cleared.
3. **AGPL and other reciprocal/copyleft code:** Keep it in its source repository or in a separately governed, clearly identified component. Do not copy it into this repository or into permissively licensed shared packages without a documented compatibility review and approval.
4. **No license laundering:** Renaming, wrapping, translating, or making substantial adaptations of code does not by itself remove the original license obligations. API interoperability is preferred where code reuse would create license uncertainty.
5. **Third-party and legacy materials:** Their original terms continue to govern. The repository's Apache-2.0 license does not relicense third-party works, external assets, imported code, or materials whose rights are not held by the project. Record provenance and applicable terms in NOTICE or a component-level license file.
6. **Dependencies:** Record package licenses and transitive dependency notices. Flag unknown, custom, source-available, or reciprocal licenses for review before release.
7. **Contributor authority:** Contributors must identify the source and license of submitted material and confirm they have authority to contribute it. Do not accept copied code with unknown provenance.

## Scope of the Apache-2.0 grant

The root LICENSE expresses the intended license for original contributions in this repository for which the project has authority to grant Apache-2.0 rights. NOTICE identifies known source materials and exclusions. A file with a separate license, an upstream copyright notice, or uncertain provenance is not relicensed by this policy. When in doubt, treat the material as excluded until reviewed.

This is a repository policy, not a legal opinion. Before commercial distribution or importing substantial source from another repository, obtain a qualified license review.

## No automatic license isolation

A directory name, separate package, process, subdomain, iframe, or service boundary is not by itself a determination of license compatibility or an exemption from upstream obligations. Evaluate the actual code provenance, modifications, combination, distribution and network use. Do not describe these boundaries as a legal “firewall” or promise downstream users that no copyleft obligations apply. A NOTICE records attribution; it does not grant rights the project lacks.

Do not extract or label Time Engine, choice-engine or other upstream-derived packages Apache-2.0 merely because the umbrella repository has that license. Verify exact source revisions and file-level terms, preserve required notices, and obtain appropriate review first. Unknown rights remain unresolved.

## Implementation rules

- Add an SPDX identifier and copyright attribution to new source files where appropriate.
- Preserve upstream copyright and license headers.
- Keep AGPL code in its own repository/service boundary unless counsel approves another arrangement.
- Prefer a documented HTTP API, event contract, or adapter over copying AGPL implementation code.
- Generate and review a software bill of materials (SBOM) before release.
- Maintain a provenance register for mirrored documents, code, assets, and generated artifacts.
- Do not assume a repository name or prior statement proves its current license; inspect the actual LICENSE file and relevant file headers.

## Consequences

**Benefits**
- Makes the intended licensing direction explicit for new original work.
- Makes provenance and compatibility review an explicit prerequisite for reuse.
- Allows independently reusable contracts and models after provenance review.
- Preserves product autonomy and upstream attribution.

**Costs / limitations**
- Every imported component needs provenance and license review.
- A permissive root license cannot override upstream obligations.
- Existing files may need file-level notices or exclusion records.
- The Apache-2.0 policy does not establish ownership of trademarks, brands, data, or third-party content.

## Acceptance checklist

- [ ] Verify the current license in each source repository, beginning with JUSCR-FreForAll.
- [ ] Inventory file-level copyright and license headers in mirrored or imported content.
- [ ] Confirm the project has authority to license all original materials under the root LICENSE.
- [ ] Add component-level LICENSE/NOTICE files where a component has separate terms.
- [ ] Run dependency license inventory and SBOM generation in CI before a public software release.
- [ ] Obtain legal review before copying or adapting AGPL code or making a commercial release.
