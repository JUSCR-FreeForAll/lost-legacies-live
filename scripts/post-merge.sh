#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Keep the separate acceptance-test database on the same schema as development.
DATABASE_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.pathname="/fortress_test";console.log(u.toString())')" pnpm --filter db push
