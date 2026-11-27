import { pool } from "@workspace/db";
import type { Request, RequestHandler } from "express";
import { createTenant } from "./ledger";

export interface AuthIdentity {
  userId: string;
  sessionId: string | null;
  /** Token issued-at, seconds since epoch. */
  issuedAt: number | null;
}

/** Abstracts the identity provider so the core is testable without Clerk. */
export interface AuthProvider {
  readonly name: string;
  identify(req: Request): AuthIdentity | null;
  /**
   * When the provider session was created, in seconds since epoch. Used only
   * for users with a security cutoff, so a refreshed token from a session
   * that existed before the cutoff is still refused.
   */
  sessionCreatedAt?(req: Request, sessionId: string): Promise<number | null>;
}

export interface ProviderSession {
  id: string;
  /** Creation time, milliseconds since epoch. */
  createdAt: number;
}

/** Ends provider-side sessions (Clerk in production). */
export interface SessionRevoker {
  readonly name: string;
  /** Every active session for the user (all pages). Throws when the provider is unavailable. */
  listActiveSessions(userId: string): Promise<ProviderSession[]>;
  revokeSession(sessionId: string): Promise<void>;
}

function deny(res: Parameters<RequestHandler>[1], req: Request, status: number, code: string, error: string) {
  res.status(status).json({ error, code, requestId: String(req.id ?? "") });
}

export function isBearerCredential(req: Request): boolean {
  return /^Bearer\s+pf_/i.test(req.header("authorization") ?? "");
}

export function requireUser(auth: AuthProvider): RequestHandler {
  return (req, res, next) => {
    if (isBearerCredential(req)) {
      deny(res, req, 403, "FORBIDDEN", "API credentials only authorize their own export or ingest endpoint.");
      return;
    }
    const identity = auth.identify(req);
    if (!identity?.userId) {
      deny(res, req, 401, "UNAUTHENTICATED", "Sign in is required.");
      return;
    }
    void (async () => {
      const r = await pool.query<{ sessions_not_before: Date | null; exempt_session_id: string | null; revoked: boolean }>(
        `SELECT s.sessions_not_before, s.exempt_session_id,
           EXISTS (SELECT 1 FROM fortress_revoked_sessions x WHERE x.session_id = $2 AND x.user_id = $1) AS revoked
         FROM (SELECT 1) one LEFT JOIN fortress_user_security s ON s.user_id = $1`,
        [identity.userId, identity.sessionId ?? ""],
      );
      const sec = r.rows[0]!;
      if (sec.revoked) {
        deny(res, req, 401, "SESSION_REVOKED", "This session was ended by a security action. Sign in again.");
        return;
      }
      if (sec.sessions_not_before && !(identity.sessionId && sec.exempt_session_id === identity.sessionId)) {
        const notBefore = Math.floor(sec.sessions_not_before.getTime() / 1000);
        // Judge the session by when it was created, not when its token was
        // refreshed; fall back to token issue time only if the provider
        // cannot report creation time.
        let created: number | null = null;
        if (identity.sessionId && auth.sessionCreatedAt) {
          try {
            created = await auth.sessionCreatedAt(req, identity.sessionId);
          } catch {
            deny(res, req, 503, "SESSION_CHECK_UNAVAILABLE", "Your session could not be checked right now. Try again shortly.");
            return;
          }
        }
        const reference = created ?? identity.issuedAt;
        if (reference === null || reference <= notBefore) {
          deny(res, req, 401, "SESSION_REVOKED", "This session was ended by a security action. Sign in again.");
          return;
        }
      }
      res.locals.userId = identity.userId;
      res.locals.sessionId = identity.sessionId;
      next();
    })().catch(next);
  };
}

export const resolveTenant: RequestHandler = async (req, res, next) => {
  const userId = res.locals.userId as string;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await createTenant(client, userId);
    const ownerResult = await client.query<{ id: string }>(
      "SELECT id FROM fortress_tenants WHERE owner_user_id = $1",
      [userId],
    );
    const ownerTenantId = ownerResult.rows[0]?.id;
    if (!ownerTenantId) throw new Error("TENANT_CREATE_FAILED");
    await client.query(
      `INSERT INTO fortress_members (tenant_id, user_id, role)
       VALUES ($1, $2, 'admin') ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [ownerTenantId, userId],
    );
    const requested = req.header("x-tenant-id");
    const tenantId = requested && /^[0-9a-f-]{36}$/i.test(requested) ? requested : ownerTenantId;
    const member = await client.query<{ role: string; owner_user_id: string }>(
      `SELECT m.role, t.owner_user_id FROM fortress_members m
       JOIN fortress_tenants t ON t.id = m.tenant_id
       WHERE m.tenant_id = $1 AND m.user_id = $2`,
      [tenantId, userId],
    );
    const membership = member.rows[0];
    if (!membership || !["admin", "operator"].includes(membership.role)) {
      await client.query("ROLLBACK");
      deny(res, req, 404, "NOT_FOUND", "Tenant not found.");
      return;
    }
    const tenants = await client.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM fortress_members WHERE user_id = $1 ORDER BY created_at",
      [userId],
    );
    await client.query("COMMIT");
    res.locals.tenantId = tenantId;
    res.locals.role = membership.owner_user_id === userId ? "admin" : membership.role;
    res.locals.isOwner = membership.owner_user_id === userId;
    res.locals.tenants = tenants.rows.map((r) => r.tenant_id);
    next();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(error);
  } finally {
    client.release();
  }
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (res.locals.role !== "admin") {
    deny(res, req, 403, "FORBIDDEN", "Administrator role is required for this operation.");
    return;
  }
  next();
};

export const requireOwner: RequestHandler = (req, res, next) => {
  if (!res.locals.isOwner) {
    deny(res, req, 403, "FORBIDDEN", "Only the tenant owner can perform this recovery action.");
    return;
  }
  next();
};
