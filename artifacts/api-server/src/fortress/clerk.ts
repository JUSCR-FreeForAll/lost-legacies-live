import { clerkClient, getAuth } from "@clerk/express";
import type { AuthProvider, ProviderSession, SessionRevoker } from "./auth";

/** Session creation times never change, so they are cached (bounded). */
const createdCache = new Map<string, number>();
const CACHE_MAX = 10_000;

export const clerkAuthProvider: AuthProvider = {
  name: "clerk",
  identify(req) {
    const auth = getAuth(req);
    if (!auth.userId) return null;
    const iat = (auth.sessionClaims as { iat?: number } | null)?.iat;
    return { userId: auth.userId, sessionId: auth.sessionId ?? null, issuedAt: typeof iat === "number" ? iat : null };
  },
  async sessionCreatedAt(_req, sessionId) {
    const cached = createdCache.get(sessionId);
    if (cached !== undefined) return cached;
    const session = await clerkClient.sessions.getSession(sessionId);
    const seconds = Math.floor(session.createdAt / 1000);
    if (createdCache.size >= CACHE_MAX) createdCache.delete(createdCache.keys().next().value!);
    createdCache.set(sessionId, seconds);
    return seconds;
  },
};

/** Lists (all pages) and revokes Clerk sessions so they cannot refresh tokens. */
export const clerkSessionRevoker: SessionRevoker = {
  name: "clerk",
  async listActiveSessions(userId) {
    const out: ProviderSession[] = [];
    const limit = 100;
    for (let offset = 0; offset < 10_000; offset += limit) {
      const page = await clerkClient.sessions.getSessionList({ userId, status: "active", limit, offset });
      for (const s of page.data) out.push({ id: s.id, createdAt: s.createdAt });
      if (page.data.length < limit) break;
    }
    return out;
  },
  async revokeSession(sessionId) {
    await clerkClient.sessions.revokeSession(sessionId);
  },
};
