---
name: Fortress gate evidence and dev readiness
description: Rules for keeping acceptance-gate evidence honest and dev readiness unweakened
---
Treat gate evidence as proof tied to the exact code it ran against: rerun the suite and commit evidence together with any backend change.
**Why:** diagnostics must never present old test results as proof for changed code.
**How to apply:** never hand-edit evidence; never weaken BACKUP_ENCRYPTION_KEY validation to make dev readiness green (dev stays NOT_READY until the user sets a valid key).

Schema changes must be pushed to both the dev DB and the separate `fortress_test` DB; drizzle push prompts (fails without a TTY) when tables or columns are renamed, so empty dev tables can be dropped and recreated instead.
**Why:** after a large schema rewrite, dev and test DBs kept the old tables, so prod publish carried no new tables and the suite failed 30/41.
**How to apply:** after any merge that touches lib/db schema, check that `fortress_user_security` etc. exist in both DBs before running the suite.
