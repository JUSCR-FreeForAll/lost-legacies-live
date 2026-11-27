import { canonicalize, sha256Ref } from "../canonical";
import type { SignedCheckpoint } from "../checkpoint";

/**
 * Optional external-proof commitment (architecture "External-proof phase").
 *
 * Only these four fields may ever leave the node. They are hashes and a
 * height, all derived from the checkpoint: no names, emails, contacts, device
 * ids, evidence, credentials, IPs or locations. The commitment is meant to be
 * written as a Solana Memo by an operator-controlled wallet. Fortress never
 * requires the chain to boot, verify, or recover.
 */
export interface AnchorCommitment {
  /** sha256 of the chain id, so the internal tenant id is never published. */
  chain_ref: string;
  height: number;
  tip_hash: string;
  checkpoint_hash: string;
}

const ALLOWED_KEYS = ["chain_ref", "checkpoint_hash", "height", "tip_hash"];

export function buildAnchorCommitment(signed: SignedCheckpoint): AnchorCommitment {
  return {
    chain_ref: sha256Ref(signed.checkpoint.chain_id),
    height: signed.checkpoint.height,
    tip_hash: signed.checkpoint.tip_hash,
    checkpoint_hash: signed.checkpoint_hash,
  };
}

/** Throws unless the commitment contains only opaque, non-personal fields. */
export function assertAnchorIsNonPersonal(commitment: Record<string, unknown>): void {
  const keys = Object.keys(commitment).sort();
  if (keys.join(",") !== ALLOWED_KEYS.join(",")) throw new Error("ANCHOR_FIELDS_NOT_ALLOWED");
  if (!Number.isSafeInteger(commitment.height)) throw new Error("ANCHOR_HEIGHT_INVALID");
  for (const k of ["chain_ref", "tip_hash", "checkpoint_hash"]) {
    if (!/^sha256:[0-9a-f]{64}$/.test(String(commitment[k]))) throw new Error("ANCHOR_HASH_INVALID");
  }
}

/** Exact UTF-8 memo text an operator writes on-chain. */
export function anchorMemo(commitment: AnchorCommitment): string {
  assertAnchorIsNonPersonal(commitment as unknown as Record<string, unknown>);
  return `pf-anchor-v1 ${canonicalize(commitment)}`;
}

export function commitmentHash(commitment: AnchorCommitment): string {
  return sha256Ref(canonicalize(commitment));
}

/** Solana transaction signatures are base58, 64 bytes (~87-88 chars). */
export function isSolanaSignature(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value);
}
