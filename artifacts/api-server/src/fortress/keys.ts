import { createHash } from "node:crypto";
import {
  buildManifest,
  deriveSeed,
  signerFromSeed,
  type ChainManifest,
  type Signer,
} from "@workspace/fortress-core";
import { fail } from "./errors";

/**
 * Key separation. BACKUP_ENCRYPTION_KEY (the KEK) only wraps recovery keys.
 * Purpose-specific secrets are derived from it with HKDF so the derived
 * material can never be used to recover the KEK:
 *   - checkpoint signing seed (Ed25519), overridable by FORTRESS_SIGNING_SEED
 *   - recovery-code pepper
 *   - credential token pepper
 * Recovery keys (per tenant, shown once) and extraction/ingest credentials
 * (random, hashed) are independent random values, never derived.
 */
export function parseMasterKek(raw = process.env.BACKUP_ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("ENCRYPTION_KEY_UNAVAILABLE");
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY_INVALID");
  return key;
}

export function getKek(): Buffer {
  try {
    return parseMasterKek();
  } catch (err) {
    if ((err as Error).message === "ENCRYPTION_KEY_INVALID") {
      throw fail(503, "ENCRYPTION_KEY_INVALID", "The server encryption key is invalid. Operations are paused.");
    }
    throw fail(503, "ENCRYPTION_KEY_UNAVAILABLE", "The server encryption key is not configured. Operations are paused.");
  }
}

export function encryptionStatus(): "configured" | "not_configured" | "invalid" {
  try {
    parseMasterKek();
    return "configured";
  } catch (err) {
    return (err as Error).message === "ENCRYPTION_KEY_INVALID" ? "invalid" : "not_configured";
  }
}

let cachedSigner: { source: string; signer: Signer } | null = null;

export function signingKeySource(): "FORTRESS_SIGNING_SEED" | "derived_from_kek" {
  return process.env.FORTRESS_SIGNING_SEED ? "FORTRESS_SIGNING_SEED" : "derived_from_kek";
}

export function getSigner(): Signer {
  const override = process.env.FORTRESS_SIGNING_SEED;
  const sourceTag = override
    ? `seed:${createHash("sha256").update(override).digest("hex")}`
    : `kek:${createHash("sha256").update(getKek()).digest("hex")}`;
  if (cachedSigner?.source === sourceTag) return cachedSigner.signer;
  let seed: Buffer;
  if (override) {
    seed = /^[0-9a-fA-F]{64}$/.test(override) ? Buffer.from(override, "hex") : Buffer.from(override, "base64");
    if (seed.length !== 32) throw fail(503, "ENCRYPTION_KEY_INVALID", "FORTRESS_SIGNING_SEED must be 32 bytes.");
  } else {
    seed = deriveSeed(getKek(), "checkpoint-signing");
  }
  const signer = signerFromSeed(seed);
  seed.fill(0);
  cachedSigner = { source: sourceTag, signer };
  return signer;
}

export function recoveryCodePepper(): Buffer {
  return deriveSeed(getKek(), "recovery-code-pepper");
}

export function installationName(): string {
  return process.env.FORTRESS_INSTALLATION_NAME || "phoenix-fortress";
}

export function tenantManifest(tenantId: string, trustKey = getSigner().keyId): ChainManifest {
  return buildManifest({ installationName: installationName(), trustKey, scope: tenantId });
}

export function archiveDir(): string {
  return process.env.FORTRESS_ARCHIVE_DIR || ".data/archive";
}
