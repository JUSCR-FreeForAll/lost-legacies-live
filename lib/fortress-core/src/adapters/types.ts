/**
 * Adapter contract (architecture "Interoperability phase").
 * Adapters never receive vault keys and cannot bypass core authorization,
 * consent, or idempotency: they only validate, decide, and canonicalize.
 */
export interface Actor {
  userId: string;
  role: "admin" | "operator";
  tenantId: string;
}

export interface ConsentContext {
  granted: ReadonlySet<string>;
}

export type AuthorizationDecision =
  | { allow: true }
  | { allow: false; code: "CONSENT_REQUIRED" | "FORBIDDEN" | "UNTRUSTED_SENDER"; message: string };

export interface FortressEvent {
  eventType: string;
  objectRef: string;
  meta: Record<string, unknown>;
  canonicalPayload: Buffer;
}

export interface FortressAdapter<V> {
  readonly name: string;
  readonly consentPurpose: string;
  validate(envelope: Buffer): V;
  authorize(envelope: V, actor: Actor, consent: ConsentContext): AuthorizationDecision;
  canonicalEvent(envelope: V): Promise<FortressEvent>;
}

export class AdapterError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
  }
}
