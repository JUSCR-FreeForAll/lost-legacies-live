import { createHash } from "node:crypto";

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * - Object members sorted by UTF-16 code units (Array.prototype.sort default).
 * - Numbers serialized with the ECMAScript Number-to-String algorithm (what
 *   JSON.stringify uses), which is what RFC 8785 mandates. NaN/Infinity rejected.
 * - Strings serialized with JSON.stringify escaping (RFC 8785 section 3.2.2.2).
 * - Lone surrogates are rejected rather than escaped, so that every accepted
 *   value has exactly one UTF-8 encoding.
 */
export const CANONICALIZATION = "jcs-rfc8785-v1" as const;
export const SUPPORTED_CANONICALIZATIONS: readonly string[] = [CANONICALIZATION];

export class CanonicalizationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function canonicalize(value: unknown): string {
  const seen = new Set<object>();
  const walk = (item: unknown): string => {
    if (item === null) return "null";
    if (typeof item === "boolean") return item ? "true" : "false";
    if (typeof item === "string") {
      if (LONE_SURROGATE.test(item)) throw new CanonicalizationError("NON_CANONICAL_STRING");
      return JSON.stringify(item);
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new CanonicalizationError("NON_CANONICAL_NUMBER");
      return JSON.stringify(item);
    }
    if (typeof item === "bigint") throw new CanonicalizationError("NON_CANONICAL_BIGINT");
    if (Array.isArray(item)) {
      if (seen.has(item)) throw new CanonicalizationError("NON_CANONICAL_CYCLE");
      seen.add(item);
      const out = `[${item.map(walk).join(",")}]`;
      seen.delete(item);
      return out;
    }
    if (typeof item === "object") {
      const proto = Object.getPrototypeOf(item);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalizationError("NON_CANONICAL_OBJECT");
      }
      const record = item as Record<string, unknown>;
      if (seen.has(record)) throw new CanonicalizationError("NON_CANONICAL_CYCLE");
      seen.add(record);
      const keys = Object.keys(record).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const v = record[key];
        if (v === undefined) throw new CanonicalizationError("NON_CANONICAL_UNDEFINED");
        if (LONE_SURROGATE.test(key)) throw new CanonicalizationError("NON_CANONICAL_STRING");
        parts.push(`${JSON.stringify(key)}:${walk(v)}`);
      }
      seen.delete(record);
      return `{${parts.join(",")}}`;
    }
    throw new CanonicalizationError("NON_CANONICAL_VALUE");
  };
  return walk(value);
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), "utf8");
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Prefixed digest used in chain envelopes: `sha256:<hex>`. */
export function sha256Ref(value: string | Uint8Array): string {
  return `sha256:${sha256Hex(value)}`;
}

export function digestCanonical(value: unknown): string {
  return sha256Ref(canonicalBytes(value));
}

export const ZERO_REF = `sha256:${"0".repeat(64)}`;
