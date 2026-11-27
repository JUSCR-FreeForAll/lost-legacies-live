import { pool } from "@workspace/db";
import type { SessionRevoker } from "./auth";
import { logger } from "../lib/logger";

export interface ProviderRevocationResult {
  /** Sessions the provider confirmed as revoked in this call. */
  revoked: number;
  /** True when listing or some revocations failed; the background retry continues. */
  pending: boolean;
}

/**
 * After a security cutoff has been committed, end every provider session that
 * existed before it (except the exempt one). Each session id is recorded
 * locally first, so it is refused on every request even if the provider call
 * fails; failures are retried by startRevocationRetry.
 */
export async function revokeProviderSessions(revoker: SessionRevoker, userId: string): Promise<ProviderRevocationResult> {
  const sec = await pool.query<{ sessions_not_before: Date; exempt_session_id: string | null }>(
    "SELECT sessions_not_before, exempt_session_id FROM fortress_user_security WHERE user_id = $1",
    [userId],
  );
  const row = sec.rows[0];
  if (!row) return { revoked: 0, pending: false };
  let sessions;
  try {
    sessions = await revoker.listActiveSessions(userId);
  } catch (err) {
    await pool.query("UPDATE fortress_user_security SET provider_sync_pending = true WHERE user_id = $1", [userId]);
    logger.warn({ err: (err as Error).message }, "Provider session listing failed; will retry");
    return { revoked: 0, pending: true };
  }
  const cutoff = row.sessions_not_before.getTime();
  const targets = sessions.filter((s) => s.id !== row.exempt_session_id && s.createdAt <= cutoff);
  for (const t of targets) {
    await pool.query(
      "INSERT INTO fortress_revoked_sessions (session_id, user_id) VALUES ($1,$2) ON CONFLICT (session_id) DO NOTHING",
      [t.id, userId],
    );
  }
  await pool.query("UPDATE fortress_user_security SET provider_sync_pending = false WHERE user_id = $1", [userId]);
  let revoked = 0;
  let failed = 0;
  for (const t of targets) {
    if (await revokeOne(revoker, t.id)) revoked += 1;
    else failed += 1;
  }
  return { revoked, pending: failed > 0 };
}

async function revokeOne(revoker: SessionRevoker, sessionId: string): Promise<boolean> {
  try {
    await revoker.revokeSession(sessionId);
    await pool.query("UPDATE fortress_revoked_sessions SET provider_revoked = true, last_error = NULL WHERE session_id = $1", [sessionId]);
    return true;
  } catch (err) {
    await pool.query(
      "UPDATE fortress_revoked_sessions SET attempts = attempts + 1, last_error = $2 WHERE session_id = $1",
      [sessionId, (err as Error).message.slice(0, 300)],
    );
    return false;
  }
}

/** One retry pass over failed listings and failed provider revocations. */
export async function retryPendingRevocations(revoker: SessionRevoker): Promise<void> {
  const users = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM fortress_user_security WHERE provider_sync_pending = true LIMIT 50",
  );
  for (const u of users.rows) await revokeProviderSessions(revoker, u.user_id);
  const sessions = await pool.query<{ session_id: string }>(
    "SELECT session_id FROM fortress_revoked_sessions WHERE provider_revoked = false AND attempts < 50 ORDER BY revoked_at LIMIT 100",
  );
  for (const s of sessions.rows) await revokeOne(revoker, s.session_id);
}

export function startRevocationRetry(revoker: SessionRevoker, intervalMs = 60_000): void {
  const tick = () => {
    retryPendingRevocations(revoker)
      .catch((err: Error) => logger.warn({ err: err.message }, "Session revocation retry pass failed"))
      .finally(() => setTimeout(tick, intervalMs).unref());
  };
  setTimeout(tick, intervalMs).unref();
}
