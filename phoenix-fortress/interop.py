"""Independent, read-only Fortress interoperability adapter."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen

def parse(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    def invalid(value):
        raise ValueError("invalid JSON constant")
    value = json.loads(raw, object_pairs_hook=unique, parse_constant=invalid)
    if not isinstance(value, dict):
        raise ValueError("FAIL_CLOSED: expected JSON object")
    return value

def validate_health(data, minimum=0, expected=""):
    if not isinstance(data, dict) or data.get("status") != "READY":
        raise ValueError("FAIL_CLOSED: not ready")
    height = data.get("chain_height")
    tip = data.get("tip_hash")
    if type(height) is not int or height < max(0, minimum):
        raise ValueError("FAIL_CLOSED: invalid height")
    if not isinstance(tip, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", tip):
        raise ValueError("FAIL_CLOSED: invalid tip")
    if expected and tip.lower() != expected.lower():
        raise ValueError("FAIL_CLOSED: unexpected tip")
    if data.get("service") != "phoenix-fortress" or data.get("ledger_sync") is not True:
        raise ValueError("FAIL_CLOSED: service or ledger mismatch")
    return data

def query_health():
    url = os.environ.get("FORTRESS_HEALTH_URL", "http://127.0.0.1:8080/health")
    with urlopen(url, timeout=10) as response:
        if response.status != 200:
            raise ValueError("FAIL_CLOSED: HTTP status")
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError("FAIL_CLOSED: oversized response")
    return validate_health(parse(raw.decode("utf-8")), int(os.environ.get("FORTRESS_MIN_CHAIN_HEIGHT", "0")), os.environ.get("FORTRESS_EXPECTED_TIP_HASH", ""))

def query_fortress_state(db_path="./data/phoenix_fortress.db", ledger_path="./data/ledger.jsonl", cli_path=None):
    cli = cli_path or os.environ.get("FORTRESS_CLI_PATH")
    if not cli:
        cli = next((p for p in ("fortress_cli.py", "phoenix-fortress/fortress_cli.py") if Path(p).is_file()), None)
    if not cli or not Path(cli).is_file():
        raise FileNotFoundError("FAIL_CLOSED: missing Fortress CLI")
    env = os.environ.copy()
    env.setdefault("PYTHONPATH", ".:phoenix-fortress")
    proc = subprocess.run([sys.executable, cli, "--db", db_path, "--ledger", ledger_path, "--json"], env=env, capture_output=True, timeout=30, check=True)
    return parse(proc.stdout.decode("utf-8"))

if __name__ == "__main__":
    print(json.dumps(query_health()))
