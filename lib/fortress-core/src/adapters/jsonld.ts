import jsonld from "jsonld";
import { sha256Ref } from "../canonical";
import {
  AdapterError,
  type Actor,
  type AuthorizationDecision,
  type ConsentContext,
  type FortressAdapter,
  type FortressEvent,
} from "./types";

/**
 * JSON-LD adapter. Graph identity uses W3C RDF Dataset Canonicalization
 * (RDFC-1.0) via rdf-canonize, never textual JSON ordering. Remote contexts are
 * never fetched: only the contexts bundled below (or inline contexts) resolve.
 */
export const FORTRESS_CONTEXT_URL = "https://w3id.org/phoenix-fortress/v1";

export const BUNDLED_CONTEXTS: Record<string, unknown> = {
  [FORTRESS_CONTEXT_URL]: {
    "@context": {
      "@version": 1.1,
      pf: "https://w3id.org/phoenix-fortress/vocab#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      RecoveryRecord: "pf:RecoveryRecord",
      EvidenceReference: "pf:EvidenceReference",
      name: "pf:name",
      description: "pf:description",
      digest: "pf:digest",
      recordedAt: { "@id": "pf:recordedAt", "@type": "xsd:dateTime" },
      relatesTo: { "@id": "pf:relatesTo", "@type": "@id" },
      status: "pf:status",
    },
  },
};

export const MAX_JSONLD_BYTES = 64 * 1024;

export interface ValidatedJsonLd {
  document: Record<string, unknown>;
  bytes: number;
}

const offlineLoader = async (url: string) => {
  const doc = BUNDLED_CONTEXTS[url];
  if (!doc) {
    throw new AdapterError("REMOTE_CONTEXT_BLOCKED", `Context ${url} is not bundled; remote contexts are never fetched.`);
  }
  return { contextUrl: undefined, documentUrl: url, document: doc };
};

export async function canonicalizeJsonLd(document: unknown): Promise<string> {
  try {
    const options = {
      algorithm: "RDFC-1.0",
      format: "application/n-quads",
      documentLoader: offlineLoader,
      safe: true,
    };
    return (await (jsonld.canonize as (d: unknown, o: unknown) => Promise<string>)(document, options));
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    const cause = (err as { details?: { cause?: { code?: string } } })?.details?.cause;
    if (cause instanceof AdapterError || /REMOTE_CONTEXT_BLOCKED|not bundled/.test(message) || cause?.code === "REMOTE_CONTEXT_BLOCKED") {
      throw new AdapterError("REMOTE_CONTEXT_BLOCKED", "Remote JSON-LD contexts are not fetched. Use the bundled Fortress context or inline contexts.");
    }
    throw new AdapterError("JSONLD_INVALID", "The JSON-LD document could not be converted to an RDF dataset in safe mode.");
  }
}

export const jsonLdAdapter: FortressAdapter<ValidatedJsonLd> = {
  name: "jsonld",
  consentPurpose: "jsonld_import",
  validate(envelope: Buffer): ValidatedJsonLd {
    if (envelope.length > MAX_JSONLD_BYTES) throw new AdapterError("PAYLOAD_TOO_LARGE");
    let parsed: unknown;
    try {
      parsed = JSON.parse(envelope.toString("utf8"));
    } catch {
      throw new AdapterError("JSONLD_INVALID", "Body is not JSON.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AdapterError("JSONLD_INVALID", "Top-level JSON-LD must be an object.");
    }
    if (!("@context" in parsed)) throw new AdapterError("JSONLD_INVALID", "@context is required.");
    return { document: parsed as Record<string, unknown>, bytes: envelope.length };
  },
  authorize(_env: ValidatedJsonLd, actor: Actor, consent: ConsentContext): AuthorizationDecision {
    if (!consent.granted.has("jsonld_import")) {
      return { allow: false, code: "CONSENT_REQUIRED", message: "Grant the jsonld_import consent before importing linked data." };
    }
    if (actor.role !== "admin" && actor.role !== "operator") {
      return { allow: false, code: "FORBIDDEN", message: "Tenant membership is required." };
    }
    return { allow: true };
  },
  async canonicalEvent(env: ValidatedJsonLd): Promise<FortressEvent> {
    const nquads = await canonicalizeJsonLd(env.document);
    if (!nquads.trim()) throw new AdapterError("JSONLD_EMPTY", "Document produced an empty RDF dataset.");
    const payload = Buffer.from(nquads, "utf8");
    return {
      eventType: "INTEROP_JSONLD_ACCEPTED",
      objectRef: sha256Ref(payload),
      meta: {
        adapter: "jsonld",
        canonicalization: "RDFC-1.0",
        quads: nquads.trim().split("\n").length,
      },
      canonicalPayload: payload,
    };
  },
};
