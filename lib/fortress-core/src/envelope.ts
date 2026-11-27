import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { canonicalize, sha256Hex } from "./canonical";

/** AES-256-GCM envelope encryption with associated data binding. */
export type CiphertextEnvelope = {
  ciphertext: string;
  nonce: string;
  tag: string;
};

export const ENVELOPE_ALGORITHM = "AES-256-GCM" as const;

export function randomKey(): Buffer {
  return randomBytes(32);
}

export function encryptAesGcm(plaintext: Buffer, key: Buffer, aad: string): CiphertextEnvelope {
  if (key.length !== 32) throw new Error("INVALID_KEY_LENGTH");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptAesGcm(envelope: CiphertextEnvelope, key: Buffer, aad: string): Buffer {
  if (key.length !== 32) throw new Error("INVALID_KEY_LENGTH");
  const tag = Buffer.from(envelope.tag, "base64");
  const nonce = Buffer.from(envelope.nonce, "base64");
  if (tag.length !== 16 || nonce.length !== 12) throw new Error("MALFORMED_ENVELOPE");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
}

export interface SealedObject {
  checksum: string;
  bytes: number;
  ciphertext: CiphertextEnvelope;
  wrappedDataKey: CiphertextEnvelope;
}

/**
 * Seal canonical bytes with a fresh per-object data key, and wrap that data key
 * with the owner's recovery key. Context strings bind ciphertext to its record.
 */
export function sealBytes(plaintext: Buffer, recoveryKey: Buffer, context: string): SealedObject {
  const checksum = sha256Hex(plaintext);
  const dataKey = randomKey();
  try {
    return {
      checksum,
      bytes: plaintext.byteLength,
      ciphertext: encryptAesGcm(plaintext, dataKey, `${context}:payload:v1:${checksum}`),
      wrappedDataKey: encryptAesGcm(dataKey, recoveryKey, `${context}:data-key:v1`),
    };
  } finally {
    dataKey.fill(0);
  }
}

export function openBytes(
  ciphertext: CiphertextEnvelope,
  wrappedDataKey: CiphertextEnvelope,
  recoveryKey: Buffer,
  context: string,
  expectedChecksum: string,
): Buffer {
  const dataKey = decryptAesGcm(wrappedDataKey, recoveryKey, `${context}:data-key:v1`);
  try {
    const bytes = decryptAesGcm(ciphertext, dataKey, `${context}:payload:v1:${expectedChecksum}`);
    if (sha256Hex(bytes) !== expectedChecksum) throw new Error("CHECKSUM_MISMATCH");
    return bytes;
  } finally {
    dataKey.fill(0);
  }
}

export function sealJson(value: unknown, recoveryKey: Buffer, context: string, maxBytes: number): SealedObject {
  const plaintext = Buffer.from(canonicalize(value), "utf8");
  if (plaintext.byteLength > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  return sealBytes(plaintext, recoveryKey, context);
}

export function openJson(
  ciphertext: CiphertextEnvelope,
  wrappedDataKey: CiphertextEnvelope,
  recoveryKey: Buffer,
  context: string,
  expectedChecksum: string,
): { bytes: Buffer; value: unknown } {
  const bytes = openBytes(ciphertext, wrappedDataKey, recoveryKey, context, expectedChecksum);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) as unknown };
}

/** Rewrap a data key from one recovery key to another without touching payload ciphertext. */
export function rewrapDataKey(
  wrapped: CiphertextEnvelope,
  fromKey: Buffer,
  toKey: Buffer,
  context: string,
): CiphertextEnvelope {
  const dataKey = decryptAesGcm(wrapped, fromKey, `${context}:data-key:v1`);
  try {
    return encryptAesGcm(dataKey, toKey, `${context}:data-key:v1`);
  } finally {
    dataKey.fill(0);
  }
}
