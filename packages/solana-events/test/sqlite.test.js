import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteEventStore } from "../src/sqlite-store.js";

// node:sqlite gives real SQLite persistence without a native third-party dependency.
// Adapt its transaction helper to the documented better-sqlite3-compatible interface.
function open(path) {
  const db = new DatabaseSync(path);
  db.transaction = callback => () => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = callback();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  return db;
}
const event = (commitment = "confirmed") => ({
  eventKey: "p:s:0", programId: "p", signature: "s", eventIndex: 0,
  eventName: "Created", data: { amount: 2n }, slot: 12, commitment,
  observedAt: 1000, provenance: { anchorVersion: "1.2.2", parserVersion: "1.2.2", idlVersion: "fixture" }
});

test("SQLite survives process restart and reclaims a timed-out processing lease", () => {
  const dir = mkdtempSync(join(tmpdir(), "lost-legacies-sqlite-"));
  const path = join(dir, "events.db");
  let clock = 1000, db = open(path);
  try {
    let store = new SqliteEventStore(db, { leaseMs: 100, now: () => clock });
    assert.equal(store.put(event()).inserted, true);
    assert.equal(store.claim("p:s:0"), 1);
    assert.equal(store.claim("p:s:0"), false);
    assert.equal(store.listPending().length, 0);
    db.close();
    clock = 1200;
    db = open(path);
    store = new SqliteEventStore(db, { leaseMs: 100, now: () => clock });
    assert.equal(store.listPending().length, 1);
    assert.equal(store.claim("p:s:0"), 2);
    assert.throws(() => store.complete("p:s:0", 1), /unclaimed/);
    store.fail("p:s:0", "retry later", 2);
    assert.equal(store.get("p:s:0").lastError, "retry later");
    assert.equal(store.claim("p:s:0"), 3);
    store.complete("p:s:0", 3);
    assert.equal(store.get("p:s:0").attempts, 3);
    const upgrade = store.put({ ...event("finalized"), slot: 13 });
    assert.equal(upgrade.upgraded, true);
    assert.equal(upgrade.record.status, "processed");
    store.put({ ...event("confirmed"), slot: 11 });
    assert.equal(store.get("p:s:0").slot, 13);
    assert.equal(store.get("p:s:0").provenance.anchorVersion, "1.2.2");
    assert.equal(store.claim("p:s:0"), false);
    store.setCheckpoint("program-history", "s");
    db.close();
    db = open(path);
    store = new SqliteEventStore(db, { now: () => clock });
    assert.equal(store.getCheckpoint("program-history"), "s");
    assert.equal(store.listTransitions()[0].transition, "finalized");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SQLite upgrade from legacy table preserves events and allows orphan reconciliation", () => {
  const db = open(":memory:");
  try {
    db.exec(`CREATE TABLE solana_events (
      event_key TEXT PRIMARY KEY, program_id TEXT NOT NULL, signature TEXT NOT NULL,
      event_index INTEGER NOT NULL, event_name TEXT NOT NULL, data_json TEXT NOT NULL,
      slot INTEGER, commitment TEXT NOT NULL CHECK(commitment IN ('confirmed','finalized')),
      status TEXT NOT NULL CHECK(status IN ('pending','processing','processed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      observed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    const store = new SqliteEventStore(db);
    store.put(event());
    assert.equal(store.markOrphaned("p:s:0", "proof: canonical finalized slot excludes signature"), true);
    assert.equal(store.get("p:s:0").status, "orphaned");
    assert.equal(store.listPending().length, 0);
    assert.equal(store.listConfirmed().length, 0);
    assert.equal(store.claim("p:s:0"), false);
    assert.equal(store.listTransitions()[0].transition, "orphaned");
    assert.throws(() => store.put(event("finalized")), /resurrect/);
  } finally {
    db.close();
  }
});
