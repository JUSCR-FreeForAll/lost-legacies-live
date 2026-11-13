#!/usr/bin/env bash
set -euo pipefail

mkdir -p \
  .github/workflows \
  apps \
  services \
  packages \
  docs/architecture \
  docs/charters \
  docs/integrations \
  docs/migration \
  docs/rights \
  tests/integration \
  tests/security \
  tests/e2e

touch \
  .gitignore \
  .env.example \
  package.json \
  pnpm-workspace.yaml \
  README.md \
  .github/workflows/ci.yml \
  docs/architecture/ADR-000-template.md \
  docs/architecture/ADR-001-integration-home.md \
  docs/architecture/ADR-002-licensing-and-consent-boundaries.md \
  docs/migration/00-inventory.md

# Preserve empty directories in Git until Phase 1 imports
for dir in apps services packages docs/charters docs/integrations docs/rights tests/integration tests/security tests/e2e; do
  touch "$dir/.gitkeep"
done

echo "Phase 0 directory skeleton created."
