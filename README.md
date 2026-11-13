# Lost Legacies Live

**Central portfolio repository and integration index**

This repository is the documentation, architecture, and coordination home for the Lost Legacies Live ecosystem. It does not replace the independent repositories that contain each product's source code.

## Operating principles

1. **Preserve project independence.** Each product retains its own repository, deployment, identity, release cycle, and history unless a separately reviewed integration explicitly changes that.
2. **Integrate by contract, not by copying everything together.** Prefer versioned APIs, events, schemas, and adapters over merging unrelated application code.
3. **Separate verified implementation from proposals.** Documents label existing work, reported status, inference, and proposed architecture distinctly.
4. **Protect people and data.** Consent, least privilege, project/tenant isolation, data minimization, auditability, and reversible rollout are design requirements.
5. **No unsafe financial or external actions by default.** Time Engine prototypes remain private and reversible. Sharing, financial activity, and external deployment require separate authorization.

## Repository map

| Path | Purpose |
|---|---|
| `docs/architecture/decisions.md` | Baseline architecture decisions and implementation/proposal boundaries |
| `docs/integration/roadmap.md` | Phased repository inventory, interoperability, integration, and verification plan |
| `docs/time/energy-economy-engine-insertion.md` | Preserved Time / Energy-Economy Engine specification from the existing Archon Fracture Back branch |
| `docs/roadmap/phase-1-hybrid-build.md` | Original Phase 1 Hybrid Build technical roadmap |
| `docs/investors/investor-ecosystem-summary.txt` | Preserved investor ecosystem source material |
| `docs/technical/sovereign-circuit-executive-summary.md` | Sovereign Circuit technical assessment and its explicit limitations |
| `docs/time/time-model-recalibration-note.txt` | Record of the existing Time Engine specification commit |
| `docs/architecture/ADR-002-licensing.md` | Apache-2.0 direction, provenance rules, and AGPL firewall |
| `docs/migration/phase-0-to-phase-6-checklist.md` | Executable phased migration and release checklist |
| `docs/integration/replit-source-mapping.md` | Replit workspace, source, and deployment verification register |
| `docs/contracts/identity-and-interoperability-contracts.md` | Draft identity, consent, event, idempotency, and provenance contracts |
| `package.json`, `pnpm-workspace.yaml` | pnpm workspace starter for future shared packages |
| `LICENSE`, `NOTICE` | Licensing terms and third-party/provenance exclusions |

## Portfolio boundaries

The investor materials group the ecosystem into six broad segments: JUSCR Unified Living Ecosystem; Phoenix Flies / PhoenixflyLive; TimeAuction; Karen Kuality Kontrol / KarenQuestThroughoutV; JUSCR-FreeForAll / community projects; and JustUsScoolCocreatingReality / 2foreachofu. These are portfolio groupings, not proof that every product is integrated or production-ready.

Other named initiatives—including Archon Fracture Back, Time Engine, Spine Alignment, Ouroboros Ward, Secret Rooms, Phoenix Fortress, and community-voted projects—must be mapped to their actual repositories and deployment records before implementation ownership or status is asserted.

## Existing Time Engine design reference

- Repository: [JUSCR-FreeForAll/archonfractureback](https://github.com/JUSCR-FreeForAll/archonfractureback)
- Branch: `codex/six-segment-interoperability`
- Commit: [`6d126e8f63ee`](https://github.com/JUSCR-FreeForAll/archonfractureback/commit/6d126e8f63ee)
- Specification: [docs/time/energy-economy-engine-insertion.md](https://github.com/JUSCR-FreeForAll/archonfractureback/blob/codex/six-segment-interoperability/docs/time/energy-economy-engine-insertion.md)

The specification is mirrored here for discoverability. The original repository and commit remain the source-of-origin reference.

## Status language

- **Implemented / committed:** supported by an identifiable repository artifact or commit.
- **Reported:** stated in supplied project materials but not independently re-audited here.
- **Proposed:** a roadmap or architecture target, not a deployed capability.
- **Unverified:** requires repository, deployment, test, or operational evidence.

Do not use investor targets, illustrative savings, proposed compliance controls, or planned customer counts as achieved results.

## First engineering sequence

1. Inventory repositories, default branches, active branches, deployments, and owners.
2. Record each project's stack, entry points, tests, data stores, authentication, secrets requirements, and release process.
3. Define shared contracts and project isolation before connecting systems.
4. Integrate through small adapters and non-destructive pull requests.
5. Verify tests, staging behavior, security boundaries, and rollback before production release.

See [the integration roadmap](docs/integration/roadmap.md), [architecture decisions](docs/architecture/decisions.md), [ADR-002 licensing](docs/architecture/ADR-002-licensing.md), and the [Phase 0–6 checklist](docs/migration/phase-0-to-phase-6-checklist.md). The pnpm workspace is scaffolding only: no application source has been moved into this repository.
