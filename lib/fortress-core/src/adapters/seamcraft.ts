import { canonicalBytes, sha256Ref } from "../canonical";
import { verifyCanonical } from "../signatures";
import {
  AdapterError,
  type Actor,
  type AuthorizationDecision,
  type ConsentContext,
  type FortressAdapter,
  type FortressEvent,
} from "./types";

/**
 * PROVISIONAL Seamcraft envelope adapter.
 *
 * No published Seamcraft specification was available when this was written, so
 * the envelope below is Phoenix Fortress's own provisional shape (version
 * "0.1-provisional"). It is deliberately strict: signed sender, recipient
 * binding, bounded clock skew, nonce for replay protection (enforced by the
 * caller's persistent nonce store), and a size limit.
 */
export const SEAMCRAFT_VERSION = "0.1-provisional" as const;
export const MAX_SEAMCRAFT_BYTES = 64 * 1024;
export const SEAMCRAFT_MAX_SKEW_MS = 5 * 60_000;

export interface SeamcraftEnvelope {
  type: "seamcraft.envelope";
  version: typeof SEAMCRAFT_VERSION;
  sender: string;
  recipient: string;
  nonce: string;
  issued_at: string;
  payload_type: "application/json";
  payload: unknown;
  signature: string;
}

export interface ValidatedSeamcraft {
  envelope: SeamcraftEnvelope;
}

export function unsignedEnvelope(env: SeamcraftEnvelope): Omit<SeamcraftEnvelope, "signature"> {
  const { signature: _s, ...rest } = env;
  return rest;
}

export function createSeamcraftAdapter(opts: {
  recipient: string;
  trustedSenders: readonly string[];
  now?: () => number;
}): FortressAdapter<ValidatedSeamcraft> {
  const now = opts.now ?? Date.now;
  return {
    name: "seamcraft",
    consentPurpose: "seamcraft_import",
    validate(raw: Buffer): ValidatedSeamcraft {
      if (raw.length > MAX_SEAMCRAFT_BYTES) throw new AdapterError("PAYLOAD_TOO_LARGE");
      let env: SeamcraftEnvelope;
      try {
        env = JSON.parse(raw.toString("utf8")) as SeamcraftEnvelope;
      } catch {
        throw new AdapterError("ENVELOPE_INVALID", "Body is not JSON.");
      }
      const allowed = new Set(["type", "version", "sender", "recipient", "nonce", "issued_at", "payload_type", "payload", "signature"]);
      if (!env || typeof env !== "object" || Object.keys(env).some((k) => !allowed.has(k))) {
        throw new AdapterError("ENVELOPE_INVALID", "Unknown envelope fields.");
      }
      if (env.type !== "seamcraft.envelope" || env.version !== SEAMCRAFT_VERSION) {
        throw new AdapterError("ENVELOPE_UNSUPPORTED_VERSION");
      }
      if (typeof env.sender !== "string" || !/^ed25519:[A-Za-z0-9_-]{43}$/.test(env.sender)) {
        throw new AdapterError("ENVELOPE_INVALID", "sender must be an ed25519 key id.");
      }
      if (typeof env.nonce !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(env.nonce)) {
        throw new AdapterError("ENVELOPE_INVALID", "nonce must be 16-64 base64url characters.");
      }
      if (env.recipient !== opts.recipient) throw new AdapterError("ENVELOPE_WRONG_RECIPIENT");
      if (env.payload_type !== "application/json" || env.payload === undefined) {
        throw new AdapterError("ENVELOPE_INVALID", "payload must be JSON.");
      }
      const issued = Date.parse(env.issued_at);
      if (!Number.isFinite(issued) || Math.abs(now() - issued) > SEAMCRAFT_MAX_SKEW_MS) {
        throw new AdapterError("ENVELOPE_STALE", "issued_at is outside the accepted window.");
      }
      if (typeof env.signature !== "string" || !verifyCanonical(env.sender, unsignedEnvelope(env), env.signature)) {
        throw new AdapterError("ENVELOPE_SIGNATURE_INVALID");
      }
      return { envelope: env };
    },
    authorize(v: ValidatedSeamcraft, _actor: Actor, consent: ConsentContext): AuthorizationDecision {
      if (!consent.granted.has("seamcraft_import")) {
        return { allow: false, code: "CONSENT_REQUIRED", message: "Grant the seamcraft_import consent first." };
      }
      if (!opts.trustedSenders.includes(v.envelope.sender)) {
        return { allow: false, code: "UNTRUSTED_SENDER", message: "Sender key is not registered for this tenant." };
      }
      return { allow: true };
    },
    async canonicalEvent(v: ValidatedSeamcraft): Promise<FortressEvent> {
      const payload = canonicalBytes(v.envelope.payload);
      return {
        eventType: "INTEROP_SEAMCRAFT_ACCEPTED",
        objectRef: sha256Ref(payload),
        meta: {
          adapter: "seamcraft",
          envelopeVersion: SEAMCRAFT_VERSION,
          sender: v.envelope.sender,
          nonceRef: sha256Ref(v.envelope.nonce),
        },
        canonicalPayload: payload,
      };
    },
  };
}
