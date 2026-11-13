# Replit source and deployment mapping

**Purpose:** Build a verified map between Replit workspaces, Git repositories, build outputs, and live deployments. A public `*.replit.app` URL is not enough to establish source structure, backend presence, secrets handling, or repository ownership.

## Evidence rules

For every app, record:
- Workspace URL and workspace access status.
- Linked GitHub repository and exact owner/name.
- Default branch, deployed branch/commit, and last deployment time.
- Deployment type (Static, Autoscale, Reserved VM, Scheduled, or other), confirmed in Replit settings.
- Framework, language, package manager, runtime, build command, and output directory, confirmed from source/config.
- Entry point and route handling.
- Backend/API services, database, auth provider, storage, queues, and external integrations.
- Environment variable names required (names only; never record values).
- Domain, health endpoint, test command, deployment owner, and rollback method.
- License and source provenance.

Use these labels:
- **Verified:** inspected directly in the workspace, repository, deployment settings, or test output.
- **Reported:** stated in supplied materials but not independently checked.
- **Inferred:** a plausible interpretation, not evidence.
- **Unknown / blocked:** access or evidence unavailable.

## Current known example: Sovereign Circuit

The supplied Executive Summary reports that `https://sovereign-circuit.replit.app` did not render during its review and that the Replit workspace and referenced GitHub source were inaccessible. It inferred a static front end from the public deployment URL and common Replit patterns. This is **inference, not verified implementation**. Do not treat the following as confirmed facts:
- React, Vue, or any specific framework.
- Presence or absence of server code.
- Exact file tree, package manager, build command, or deployment configuration.
- Whether secrets, external APIs, or a backend are used.
- Whether the current live deployment is still static.

Re-verify from the actual workspace and repository before making architectural decisions.

## Portfolio inventory template

Copy one block per workspace:

| Field | Value |
|---|---|
| Product / initiative | |
| Replit workspace URL | |
| Workspace access | Verified / blocked / unknown |
| GitHub repository | |
| Default branch | |
| Deployed branch + commit | |
| Deployment URL | |
| Deployment type | |
| Framework / language | |
| Package manager + lockfile | |
| Build command | |
| Output directory / runtime | |
| Entry point / routes | |
| Backend / API | |
| Database / storage | |
| Authentication / authorization | |
| External integrations | |
| Required environment variable names | |
| Tests / build result | |
| License / provenance | |
| Maintainer / owner | |
| Rollback method | |
| Evidence links and checked date | |
| Confidence / blockers | |

## Candidate portfolio rows

The investor ecosystem summary identifies these portfolio groupings. The rows below are discovery targets, not confirmed Replit workspace or repository links.

| Product grouping | Reconciliation task |
|---|---|
| JUSCR Unified Living Ecosystem | Identify canonical launcher repo, deployment, and app registry |
| Phoenix Flies / PhoenixflyLive | Verify website and mobile companion source/deployment |
| TimeAuction | Find source repo, data model, auction state machine, and payment boundaries |
| Karen Kuality Kontrol / KarenQuestThroughoutV | Confirm source repo, current product name, and prototype status |
| JUSCR-FreForAll / community projects | Verify source license before any code reuse; preserve AGPL boundary if confirmed |
| JustUsScoolCocreatingReality / 2foreachofu | Identify learning app repos and participant-data boundaries |
| Archon Fracture Back / Spine Alignment | Map backend, branches, migrations, and API integration |
| Time Engine / Ouroboros Ward / Secret Rooms | Map to source specification and implementation separately |
| Phoenix Fortress | Locate actual repository and deployment; do not infer URL |
| Community-voted projects | Record vote provenance, ownership, and authorization before adding to portfolio |

## Inspection procedure

1. Open the Replit workspace through the authorized account.
2. Confirm its linked Git repository and active branch; do not rely on a deployment URL as a source pointer.
3. Inspect `.replit`, package manifests, lockfiles, build scripts, Dockerfiles, and deployment settings.
4. Identify the actual runtime and whether the app has server-side routes or only static assets.
5. Inspect API calls and integrations. Record secret names only and check that secret values are not committed or exposed to browser bundles.
6. Match the deployed revision to a Git commit.
7. Run the documented build and test commands in a safe environment.
8. Record evidence, date, limitations, and unresolved questions in the inventory.
9. Do not alter production settings or redeploy as part of discovery.

## Security cautions

- Never paste secret values into this register, issues, or commit messages.
- Treat public frontend configuration as public; do not place privileged keys in client bundles.
- Confirm authorization and tenant isolation at the backend, not only in the UI.
- Use staging or disposable data for migrations and integration tests.
- Keep production deployment changes outside inventory-only work.
