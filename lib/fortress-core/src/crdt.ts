/**
 * Limited, revocation-wins replicated state (a 2P-set variant).
 *
 * Only revocation propagates authority between replicas: a revocation tombstone
 * is permanent and beats any grant for the same id, regardless of timestamps or
 * merge order. A replica can never "un-revoke" by merging, and grants received
 * from peers are informational only (they never create local authority).
 *
 * Merge is commutative, associative and idempotent.
 */
export type RevocationKind = "credential" | "recovery_contact" | "consent" | "trusted_signer";

export interface Tombstone {
  kind: RevocationKind;
  id: string;
  revoked_at_us: number;
  origin: string;
}

export type RevocationState = Record<string, Tombstone>;

export function tombstoneKey(kind: RevocationKind, id: string): string {
  return `${kind}:${id}`;
}

export function addTombstone(state: RevocationState, t: Tombstone): RevocationState {
  return merge(state, { [tombstoneKey(t.kind, t.id)]: t });
}

function pick(a: Tombstone, b: Tombstone): Tombstone {
  // Deterministic choice of which record to keep; either way the id stays revoked.
  if (a.revoked_at_us !== b.revoked_at_us) return a.revoked_at_us < b.revoked_at_us ? a : b;
  return a.origin <= b.origin ? a : b;
}

export function merge(a: RevocationState, b: RevocationState): RevocationState {
  const out: RevocationState = { ...a };
  for (const [key, t] of Object.entries(b)) {
    const existing = out[key];
    out[key] = existing ? pick(existing, t) : t;
  }
  return out;
}

export function isRevoked(state: RevocationState, kind: RevocationKind, id: string): boolean {
  return tombstoneKey(kind, id) in state;
}

/** Effective active set: anything locally granted and not tombstoned anywhere. */
export function effectiveActive(
  granted: ReadonlyArray<{ kind: RevocationKind; id: string }>,
  state: RevocationState,
): Array<{ kind: RevocationKind; id: string }> {
  return granted.filter((g) => !isRevoked(state, g.kind, g.id));
}

const KINDS: readonly RevocationKind[] = ["credential", "recovery_contact", "consent", "trusted_signer"];

export function validateRevocationState(input: unknown): RevocationState {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("CRDT_MALFORMED");
  const out: RevocationState = {};
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 10_000) throw new Error("CRDT_TOO_LARGE");
  for (const [key, raw] of entries) {
    const t = raw as Partial<Tombstone>;
    if (
      !t ||
      typeof t.id !== "string" ||
      t.id.length > 200 ||
      !KINDS.includes(t.kind as RevocationKind) ||
      !Number.isSafeInteger(t.revoked_at_us) ||
      typeof t.origin !== "string" ||
      key !== tombstoneKey(t.kind as RevocationKind, t.id)
    ) {
      throw new Error("CRDT_MALFORMED");
    }
    out[key] = { kind: t.kind as RevocationKind, id: t.id, revoked_at_us: t.revoked_at_us!, origin: t.origin };
  }
  return out;
}
