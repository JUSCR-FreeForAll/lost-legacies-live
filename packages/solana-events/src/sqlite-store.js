const json = value => JSON.stringify(value, (_key, x) => typeof x === "bigint" ? x.toString() : x);

/** Synchronous better-sqlite3-compatible persistence. The host opens/closes the database. */
export class SqliteEventStore {
  constructor(db, { leaseMs = 60000, now = Date.now } = {}) {
    if (!db?.prepare || !db?.exec || !db?.transaction) throw TypeError("Expected better-sqlite3-compatible database");
    this.db = db;
    this.leaseMs = leaseMs;
    this.now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS solana_events (
        event_key TEXT PRIMARY KEY, program_id TEXT NOT NULL, signature TEXT NOT NULL,
        event_index INTEGER NOT NULL, event_name TEXT NOT NULL, data_json TEXT NOT NULL,
        slot INTEGER, commitment TEXT NOT NULL CHECK(commitment IN ('confirmed','finalized')),
        status TEXT NOT NULL CHECK(status IN ('pending','processing','processed','failed')),
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
        observed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS solana_events_pending_idx ON solana_events(status, updated_at);
      CREATE TABLE IF NOT EXISTS solana_checkpoints (name TEXT PRIMARY KEY, signature TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS solana_orphans (
        event_key TEXT PRIMARY KEY REFERENCES solana_events(event_key), evidence TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS solana_event_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL,
        transition TEXT NOT NULL, evidence TEXT, at INTEGER NOT NULL
      );
    `);
    // Older databases predate provenance; preserve their rows and table constraints.
    const columns = db.prepare("PRAGMA table_info(solana_events)").all().map(row => row.name);
    if (!columns.includes("provenance_json")) db.exec("ALTER TABLE solana_events ADD COLUMN provenance_json TEXT");
    this.getStmt = db.prepare(`
      SELECT e.*, o.evidence AS orphan_evidence
      FROM solana_events e LEFT JOIN solana_orphans o ON o.event_key=e.event_key
      WHERE e.event_key=?
    `);
  }

  map(row) {
    return row && {
      eventKey: row.event_key, programId: row.program_id, signature: row.signature,
      eventIndex: row.event_index, eventName: row.event_name, data: JSON.parse(row.data_json),
      slot: row.slot, commitment: row.commitment,
      status: row.orphan_evidence ? "orphaned" : row.status, attempts: row.attempts,
      lastError: row.last_error, observedAt: row.observed_at, updatedAt: row.updated_at,
      provenance: row.provenance_json ? JSON.parse(row.provenance_json) : null
    };
  }

  put(event) {
    return this.db.transaction(() => {
      const before = this.getStmt.get(event.eventKey);
      if (before?.orphan_evidence) throw Error("Cannot silently resurrect an orphaned event");
      const t = this.now();
      this.db.prepare(`
        INSERT OR IGNORE INTO solana_events (
          event_key, program_id, signature, event_index, event_name,
          data_json, slot, commitment, status, observed_at, updated_at, provenance_json
        ) VALUES (@eventKey, @programId, @signature, @eventIndex, @eventName,
          @dataJson, @slot, @commitment, 'pending', @observedAt, @updatedAt, @provenanceJson)
      `).run({
        eventKey: event.eventKey, programId: event.programId, signature: event.signature,
        eventIndex: event.eventIndex, eventName: event.eventName,
        dataJson: json(event.data), slot: event.slot ?? null, commitment: event.commitment,
        observedAt: event.observedAt ?? t, updatedAt: t,
        provenanceJson: event.provenance ? json(event.provenance) : null
      });
      const upgraded = before?.commitment === "confirmed" && event.commitment === "finalized";
      if (upgraded) {
        this.db.prepare(`UPDATE solana_events SET commitment='finalized',
          slot=COALESCE(?,slot), updated_at=? WHERE event_key=?`).run(event.slot ?? null, t, event.eventKey);
        this.recordTransition(event.eventKey, "finalized", null);
      }
      return { record: this.map(this.getStmt.get(event.eventKey)), inserted: !before, upgraded };
    })();
  }

  recordTransition(key, transition, evidence) {
    this.db.prepare(`INSERT INTO solana_event_transitions(event_key,transition,evidence,at)
      VALUES(?,?,?,?)`).run(key, transition, evidence, this.now());
  }

  claim(key) {
    const t = this.now();
    const claim = this.db.prepare(`UPDATE solana_events SET status='processing',
      attempts=attempts+1, updated_at=?, last_error=NULL
      WHERE event_key=? AND NOT EXISTS (SELECT 1 FROM solana_orphans o WHERE o.event_key=?)
      AND (status IN ('pending','failed') OR (status='processing' AND updated_at<=?))
      RETURNING attempts`).get(t, key, key, t - this.leaseMs);
    return claim?.attempts ?? false;
  }

  complete(key, token) {
    if (this.db.prepare(`UPDATE solana_events SET status='processed',
      last_error=NULL, updated_at=? WHERE event_key=? AND status='processing' AND attempts=?`)
      .run(this.now(), key, token ?? -1).changes !== 1) throw Error("Cannot complete unclaimed event");
  }

  fail(key, error, token) {
    if (this.db.prepare(`UPDATE solana_events SET status='failed',
      last_error=?, updated_at=? WHERE event_key=? AND status='processing' AND attempts=?`)
      .run(String(error?.message ?? error).slice(0, 2000), this.now(), key, token ?? -1).changes !== 1) {
      throw Error("Cannot fail unclaimed event");
    }
  }

  listPending({ commitment } = {}) {
    let query = `SELECT e.*, o.evidence AS orphan_evidence FROM solana_events e
      LEFT JOIN solana_orphans o ON o.event_key=e.event_key
      WHERE o.event_key IS NULL
        AND (e.status IN ('pending','failed') OR (e.status='processing' AND e.updated_at<=?))`;
    const params = [this.now() - this.leaseMs];
    if (commitment) { query += " AND e.commitment=?"; params.push(commitment); }
    query += " ORDER BY e.observed_at, e.event_key";
    return this.db.prepare(query).all(...params).map(row => this.map(row));
  }

  listConfirmed() {
    return this.db.prepare(`SELECT e.*, o.evidence AS orphan_evidence FROM solana_events e
      LEFT JOIN solana_orphans o ON o.event_key=e.event_key
      WHERE e.commitment='confirmed' AND o.event_key IS NULL`).all().map(row => this.map(row));
  }

  markOrphaned(key, evidence) {
    if (typeof evidence !== "string" || !evidence) throw TypeError("Orphan evidence required");
    return this.db.transaction(() => {
      const record = this.getStmt.get(key);
      if (!record || record.commitment !== "confirmed" || record.status === "processing" || record.orphan_evidence) return false;
      this.db.prepare("INSERT INTO solana_orphans(event_key,evidence,at) VALUES(?,?,?)")
        .run(key, evidence, this.now());
      this.recordTransition(key, "orphaned", evidence);
      return true;
    })();
  }

  get(key) { return this.map(this.getStmt.get(key)); }
  getCheckpoint(name) {
    return this.db.prepare("SELECT signature FROM solana_checkpoints WHERE name=?").get(name)?.signature ?? null;
  }
  setCheckpoint(name, signature) {
    this.db.prepare(`INSERT INTO solana_checkpoints(name,signature) VALUES(?,?)
      ON CONFLICT(name) DO UPDATE SET signature=excluded.signature`).run(name, signature);
  }
  listTransitions() {
    return this.db.prepare(`SELECT event_key AS eventKey, transition, evidence, at
      FROM solana_event_transitions ORDER BY id`).all();
  }
}
