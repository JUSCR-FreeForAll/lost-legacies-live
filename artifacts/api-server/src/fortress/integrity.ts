import { pool } from "@workspace/db";
import { encryptionStatus, getSigner, installationName } from "./keys";
import { LedgerIntegrityError, recordCondition, verifyLedgerSnapshot } from "./ledger";
import { setStartupState, startupState } from "./startup";
import { logger } from "../lib/logger";

export interface ReadinessResult {
  status: "ready" | "NOT_READY" | "RECOVERY_REQUIRED";
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  conditions: string[];
}

/**
 * Pin the installation trust key on first start. A later start with a
 * different signing key (KEK or seed changed) is a trust-key mismatch and puts
 * the whole installation into RECOVERY_REQUIRED instead of silently re-keying.
 */
export async function ensureInstallation(): Promise<void> {
  const trustKey = getSigner().keyId;
  await pool.query(
    `INSERT INTO fortress_installation (id, installation_name, trust_key)
     VALUES ('singleton', $1, $2) ON CONFLICT (id) DO NOTHING`,
    [installationName(), trustKey],
  );
  const row = await pool.query<{ trust_key: string }>("SELECT trust_key FROM fortress_installation WHERE id = 'singleton'");
  if (row.rows[0]?.trust_key !== trustKey) {
    await recordCondition(null, "TRUST_KEY_MISMATCH", { pinned: row.rows[0]?.trust_key ?? null, current: trustKey });
  }
}

/** Verify one tenant; on failure record a condition. Returns true when intact. */
export async function verifyTenantOrFlag(tenantId: string): Promise<boolean> {
  try {
    await verifyLedgerSnapshot(tenantId);
    return true;
  } catch (err) {
    if (err instanceof LedgerIntegrityError) {
      await recordCondition(tenantId, err.code, err.detail);
      return false;
    }
    throw err;
  }
}

export async function verifyAllTenants(): Promise<{ checked: number; failed: number }> {
  const tenants = await pool.query<{ id: string }>("SELECT id FROM fortress_tenants ORDER BY id");
  let failed = 0;
  for (const t of tenants.rows) if (!(await verifyTenantOrFlag(t.id))) failed += 1;
  return { checked: tenants.rows.length, failed };
}

/**
 * Startup verification. Never throws. Integrity failures become conditions;
 * an unexpected error leaves the process NOT_READY (writes refused) and
 * returns false so the caller can retry.
 */
export async function startupVerification(): Promise<boolean> {
  setStartupState("running");
  try {
    if (encryptionStatus() !== "configured") {
      setStartupState("failed", "encryption key is not configured");
      return false;
    }
    await ensureInstallation();
    const result = await verifyAllTenants();
    setStartupState("succeeded");
    logger.info(result, "Startup ledger verification finished");
    return true;
  } catch (err) {
    setStartupState("failed", (err as Error).message);
    logger.error({ err: (err as Error).message }, "Startup verification could not run; staying NOT_READY");
    return false;
  }
}

export async function readiness(): Promise<ReadinessResult> {
  const checks: ReadinessResult["checks"] = [];
  let conditions: string[] = [];
  try {
    await pool.query("SELECT 1");
    checks.push({ name: "database", ok: true, detail: "reachable" });
  } catch {
    checks.push({ name: "database", ok: false, detail: "unreachable" });
    return { status: "NOT_READY", checks, conditions };
  }
  try {
    await pool.query("SELECT id FROM fortress_installation LIMIT 0");
    checks.push({ name: "schema", ok: true, detail: "present" });
  } catch {
    checks.push({ name: "schema", ok: false, detail: "missing tables" });
    return { status: "NOT_READY", checks, conditions };
  }
  const enc = encryptionStatus();
  checks.push({ name: "encryption_key", ok: enc === "configured", detail: enc });
  if (enc !== "configured") return { status: "NOT_READY", checks, conditions };
  const startup = startupState();
  checks.push({
    name: "startup_verification",
    ok: startup.state === "succeeded",
    detail: startup.state === "failed" ? `failed: ${startup.error ?? "unknown error"}` : startup.state,
  });
  const pinned = await pool.query<{ trust_key: string }>("SELECT trust_key FROM fortress_installation WHERE id = 'singleton'");
  const current = getSigner().keyId;
  const trustOk = !pinned.rows[0] || pinned.rows[0].trust_key === current;
  checks.push({ name: "trust_key", ok: trustOk, detail: trustOk ? "matches pinned installation key" : "differs from pinned installation key" });
  if (!trustOk) await recordCondition(null, "TRUST_KEY_MISMATCH", { pinned: pinned.rows[0]!.trust_key, current });
  const open = await pool.query<{ code: string; tenant_id: string | null }>(
    "SELECT code, tenant_id FROM fortress_integrity_conditions WHERE resolved_at IS NULL ORDER BY detected_at",
  );
  conditions = open.rows.map((r) => (r.tenant_id ? `${r.code}@tenant` : `${r.code}@installation`));
  checks.push({ name: "integrity", ok: open.rows.length === 0, detail: open.rows.length ? `${open.rows.length} open condition(s)` : "no open conditions" });
  if (open.rows.length) return { status: "RECOVERY_REQUIRED", checks, conditions };
  return { status: startup.state === "succeeded" ? "ready" : "NOT_READY", checks, conditions };
}
