# Repository and Deployment Inventory

**Status:** Initial placeholder — not yet audited.

Use this file to record verified repository and deployment facts. Do not infer a repository, branch, owner, deployment URL, credentials, or production status from a project name alone.

| Project / subsystem | Repository URL | Default branch | Deployment | Owner / authority | Status | Evidence / last checked |
|---|---|---|---|---|---|---|
| JUSCR Spine | TBD | TBD | TBD | `archonfractureback` (reported authority) | Unverified | |
| Time Engine | TBD | TBD | TBD | `archonfractureback` (reported authority) | Unverified | |
| Time Auction | TBD | TBD | TBD | TBD | Unverified | |
| Five Realms / Karen Quest | TBD | TBD | TBD | TBD | Unverified | |
| Phoenix ecosystem | TBD | TBD | TBD | TBD | Unverified | |
| Secret Rooms | TBD | TBD | TBD | `archonfractureback` (reported authority) | Unverified | |
| Spine Alignment / Ouroboros Ward | TBD | TBD | TBD | TBD | Unverified | |
| `buzz` | TBD | TBD | TBD | Independent repository | Unverified | |

## Required inventory fields

For each repository or deployment, record:

- Canonical repository URL, visibility, default branch, active branches, and latest relevant commit
- Runtime, framework, package manager, entry points, and build/test/lint/typecheck commands
- Data stores, migrations, authentication, authorization, secrets, and external integrations
- Deployment provider, environment name, configured URL, deployed revision, health checks, and rollback procedure
- Data ownership, consent boundary, license, maintainers, and integration contract
- Evidence links and date of last verification

## Rules

- Keep unknown values as `TBD` or `Unverified`; never guess.
- Do not commit credentials, private keys, real environment files, or production data.
- Do not merge independent application histories as part of inventory work.
