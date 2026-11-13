# Lost Legacies Live

Central integration home for the **JUSCR / Five Realms / Time Engine / Phoenix** ecosystem.

This repository coordinates shared contracts and staged composition while preserving independent product repositories and their histories.

## Repository layout

```text
lost-legacies-live/
├── apps/        # User-facing applications (Portal, Five Realms, Karen Quest)
├── services/    # Backend authorities (JUSCR Spine, Time Engine, Time Auction)
├── packages/    # Shared domain models, contracts, provenance, and UI
├── docs/        # ADRs, charters, integrations, migration logs, and rights
└── tests/       # Cross-service integration, security, and end-to-end suites
```

## Core principles

- **GitHub is the source of truth:** Replit workspaces are prototypes or deployment targets; changes must be reconciled to GitHub.
- **Staged integration:** No big-bang merges. Stabilize backend authorities before extracting shared domain packages.
- **Private by default and explicit consent:** Secret Rooms and Time Engine records require provenance, consent-aware access, revocation paths, and strict key boundaries.
- **Independent repositories remain independent:** Integrate through versioned contracts and adapters unless a separately reviewed migration authorizes otherwise.
- **Evidence-led status:** Distinguish implemented, reported, proposed, and unverified capabilities.

## Getting started

```bash
cp .env.example .env
pnpm install
pnpm run build
```

See `docs/architecture/` for decisions and `docs/migration/00-inventory.md` for repository tracking. Never put real credentials or production secrets in `.env.example` or Git.
