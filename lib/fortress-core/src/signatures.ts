import {
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import { canonicalBytes, sha256Hex } from "./canonical";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type KeyId = `ed25519:${string}`;

export interface Signer {
  readonly keyId: KeyId;
  sign(message: Uint8Array): string;
}

export function keyIdFromRawPublicKey(raw: Buffer): KeyId {
  if (raw.length !== 32) throw new Error("INVALID_PUBLIC_KEY");
  return `ed25519:${raw.toString("base64url")}`;
}

export function publicKeyFromKeyId(keyId: string): KeyObject {
  const match = /^ed25519:([A-Za-z0-9_-]{43})$/.exec(keyId);
  if (!match) throw new Error("INVALID_KEY_ID");
  const raw = Buffer.from(match[1]!, "base64url");
  if (raw.length !== 32) throw new Error("INVALID_KEY_ID");
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

export function keyFingerprint(keyId: string): string {
  return sha256Hex(keyId).slice(0, 16);
}

/** Ed25519 signer from a 32-byte seed. The seed never leaves this object. */
export function signerFromSeed(seed: Buffer): Signer {
  if (seed.length !== 32) throw new Error("INVALID_SEED");
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const keyId = keyIdFromRawPublicKey(Buffer.from(spki.subarray(spki.length - 32)));
  return {
    keyId,
    sign(message: Uint8Array): string {
      return nodeSign(null, message, privateKey).toString("base64url");
    },
  };
}

/**
 * Derive a purpose-specific signing seed from a master secret with HKDF-SHA256.
 * Key separation: the derived seed cannot be used to recover the master secret.
 */
export function deriveSeed(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `phoenix-fortress:${purpose}:v1`, 32));
}

export function verifySignature(keyId: string, message: Uint8Array, signature: string): boolean {
  try {
    const sig = Buffer.from(signature, "base64url");
    if (sig.length !== 64) return false;
    return nodeVerify(null, message, publicKeyFromKeyId(keyId), sig);
  } catch {
    return false;
  }
}

export function signCanonical(signer: Signer, value: unknown): string {
  return signer.sign(canonicalBytes(value));
}

export function verifyCanonical(keyId: string, value: unknown, signature: string): boolean {
  try {
    return verifySignature(keyId, canonicalBytes(value), signature);
  } catch {
    return false;
  }
}
