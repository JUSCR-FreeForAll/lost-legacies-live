# Phoenix Fortress integration boundary

This directory contains a standalone Python 3 interoperability adapter, not the Fortress ledger engine. It can run without the Lost Legacies Live workspace or third-party dependencies. Run from this directory: `python -m unittest -v` and `python interop.py` (requires a running Fortress endpoint).

Source: user-supplied Cross-System Interoperability Specification, 2026-11-27. The adapter enforces JSON object parsing, READY, minimum height, expected tip, service identity and ledger synchronization. CLI calls are read-only by design; the CLI itself must be audited before use. Automatic recovery is intentionally omitted until authorization and recovery tests exist.

Configuration: FORTRESS_HEALTH_URL, FORTRESS_MIN_CHAIN_HEIGHT, FORTRESS_EXPECTED_TIP_HASH, FORTRESS_CLI_PATH, PYTHONPATH. Database and ledger paths are explicit CLI adapter arguments. Defaults follow the source specification.

Remaining gates: retrieve existing Fortress engine; verify SQLite/JSONL consistency and trusted signed checkpoints; implement authorized encrypted backup extraction and recovery; validate timestamp freshness and transport authentication; add CI and deployment targets only after engine verification. No production deployment, keys or protection guarantees are implied. Never commit secrets or personal recovery data.
