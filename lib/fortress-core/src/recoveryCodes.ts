import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Saved offline recovery codes (NIST SP 800-63B-4 "saved recovery code").
 * Each code carries 100 bits from a CSPRNG, rendered as 4 groups of 5
 * Crockford base32 characters. Only a keyed HMAC of each code is stored.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_CODE_BITS = 100;
export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCode(): string {
  const bytes = randomBytes(13); // 104 bits, we use 100
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  bits >>= 4n;
  let out = "";
  for (let i = 0; i < 20; i += 1) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const set = new Set<string>();
  while (set.size < count) set.add(generateRecoveryCode());
  return [...set];
}

/** Accept lowercase, spaces, and Crockford look-alikes (O→0, I/L→1). */
export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (!/^[0-9A-HJKMNP-TV-Z]{20}$/.test(cleaned)) return null;
  return cleaned;
}

export function hashRecoveryCode(pepper: Buffer, normalized: string, scope: string): string {
  return createHmac("sha256", pepper).update(`${scope}\u0000${normalized}`).digest("hex");
}

export function digestsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
