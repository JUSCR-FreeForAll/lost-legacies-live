import { closeSync, existsSync, fstatSync, ftruncateSync, mkdirSync, openSync, readSync, writeSync, fsyncSync } from "node:fs";
import path from "node:path";
import { pool } from "@workspace/db";
import { archiveDir } from "./keys";
import { logger } from "../lib/logger";

/**
 * Outbox exporter. Ledger blocks are written to fortress_outbox in the same
 * transaction as the block. This exporter appends them to one JSONL archive
 * per tenant, outside the database:
 *  - resumable: the last complete line's idx decides where to continue;
 *  - a partial trailing line (crash mid-write) is truncated first;
 *  - a missing archive is rebuilt from the outbox table;
 *  - write errors leave rows unexported for the next run and are reported.
 */
export interface OutboxStatus {
  lastRunAt: string | null;
  lastError: string | null;
  exported: number;
  pending: number | null;
  archiveDir: string;
}

const status: OutboxStatus = { lastRunAt: null, lastError: null, exported: 0, pending: null, archiveDir: archiveDir() };

export function outboxStatus(): OutboxStatus {
  return { ...status, archiveDir: archiveDir() };
}

function archivePath(tenantId: string): string {
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error("INVALID_TENANT_ID");
  return path.join(archiveDir(), `${tenantId}.jsonl`);
}

/** Returns the idx of the last complete line, truncating any partial tail. -1 if empty. */
export function repairArchive(file: string): number {
  if (!existsSync(file)) return -1;
  const fd = openSync(file, "r+");
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return -1;
    const chunk = Math.min(size, 1 << 20);
    const buf = Buffer.alloc(chunk);
    readSync(fd, buf, 0, chunk, size - chunk);
    let text = buf.toString("utf8");
    if (!text.endsWith("\n")) {
      const cut = text.lastIndexOf("\n");
      const keep = cut < 0 ? size - chunk : size - chunk + Buffer.byteLength(text.slice(0, cut + 1));
      ftruncateSync(fd, keep);
      text = cut < 0 ? "" : text.slice(0, cut + 1);
      if (!text) return keep === 0 ? -1 : repairArchive(file);
    }
    const lines = text.trimEnd().split("\n");
    const last = lines[lines.length - 1];
    if (!last) return -1;
    try {
      return Number((JSON.parse(last) as { idx: number }).idx);
    } catch {
      return -1;
    }
  } finally {
    closeSync(fd);
  }
}

export async function exportOutbox(limit = 5000): Promise<number> {
  status.lastRunAt = new Date().toISOString();
  try {
    mkdirSync(archiveDir(), { recursive: true });
    const tenants = await pool.query<{ tenant_id: string }>(
      "SELECT DISTINCT tenant_id FROM fortress_outbox WHERE exported_at IS NULL",
    );
    // Rebuild archives that went missing even if nothing is pending.
    const all = await pool.query<{ id: string }>("SELECT id FROM fortress_tenants");
    const ids = new Set(tenants.rows.map((r) => r.tenant_id));
    for (const t of all.rows) if (!existsSync(archivePath(t.id))) ids.add(t.id);
    let written = 0;
    for (const tenantId of ids) written += await exportTenant(tenantId, limit);
    const pending = await pool.query<{ n: string }>("SELECT count(*) AS n FROM fortress_outbox WHERE exported_at IS NULL");
    status.pending = Number(pending.rows[0]?.n ?? 0);
    status.exported += written;
    status.lastError = null;
    return written;
  } catch (err) {
    status.lastError = (err as Error).message;
    logger.error({ err: status.lastError }, "Outbox export failed; rows remain pending");
    throw err;
  }
}

async function exportTenant(tenantId: string, limit: number): Promise<number> {
  const file = archivePath(tenantId);
  const lastIdx = repairArchive(file);
  const rows = await pool.query<{ id: string; idx: number; line: string }>(
    "SELECT id, idx, line FROM fortress_outbox WHERE tenant_id = $1 AND idx > $2 ORDER BY idx LIMIT $3",
    [tenantId, lastIdx, limit],
  );
  if (rows.rows.length) {
    const fd = openSync(file, "a");
    try {
      let expected = lastIdx + 1;
      for (const row of rows.rows) {
        if (Number(row.idx) !== expected) throw new Error(`OUTBOX_GAP tenant=${tenantId} idx=${expected}`);
        writeSync(fd, `${row.line}\n`);
        expected += 1;
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  const maxIdx = rows.rows.length ? Number(rows.rows[rows.rows.length - 1]!.idx) : lastIdx;
  await pool.query(
    "UPDATE fortress_outbox SET exported_at = now() WHERE tenant_id = $1 AND idx <= $2 AND exported_at IS NULL",
    [tenantId, maxIdx],
  );
  return rows.rows.length;
}

let timer: NodeJS.Timeout | null = null;

export function startOutboxExporter(intervalMs = 5000): void {
  if (timer) return;
  timer = setInterval(() => {
    exportOutbox().catch(() => undefined);
  }, intervalMs);
  timer.unref();
}
