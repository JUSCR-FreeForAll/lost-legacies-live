---
name: Fortress dev browser testing
description: Lessons for running signed-in browser tests against the vault in dev
---
Use one throwaway encryption key for an entire test run, and never switch to a different one partway through.
**Why:** the API pins the installation trust key in the database on first start; starting again with another key records a trust-key mismatch and pauses every write until it is resolved.
**How to apply:** pass the same test-only key override for the whole run, never change the real secret, and keep the dev database schema in sync with the code before testing signed-in pages. When the run ends, return dev data to the state it was in before.
