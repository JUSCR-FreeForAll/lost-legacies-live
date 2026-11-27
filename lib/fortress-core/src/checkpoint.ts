import { CANONICALIZATION, digestCanonical } from "./canonical";
import { signCanonical, verifyCanonical, type Signer } from "./signatures";

export interface CheckpointBody {
  v: 1;
  chain_id: string;
  height: number;
  tip_hash: string;
  canonicalization: string;
  created_at_us: number;
  signer: string;
}

export interface SignedCheckpoint {
  checkpoint: CheckpointBody;
  checkpoint_hash: string;
  signature: string;
}

export interface WitnessSignature {
  witness: string;
  checkpoint_hash: string;
  signature: string;
}

export function createCheckpoint(
  signer: Signer,
  input: { chainId: string; height: number; tipHash: string; createdAtUs?: number },
): SignedCheckpoint {
  const checkpoint: CheckpointBody = {
    v: 1,
    chain_id: input.chainId,
    height: input.height,
    tip_hash: input.tipHash,
    canonicalization: CANONICALIZATION,
    created_at_us: input.createdAtUs ?? Date.now() * 1000,
    signer: signer.keyId,
  };
  return {
    checkpoint,
    checkpoint_hash: digestCanonical(checkpoint),
    signature: signCanonical(signer, checkpoint),
  };
}

export type CheckpointCheck =
  | { ok: true }
  | { ok: false; code: "MALFORMED" | "HASH_MISMATCH" | "SIGNATURE_INVALID" | "UNTRUSTED_SIGNER" };

export function verifyCheckpoint(
  signed: SignedCheckpoint,
  trustedSigners: readonly string[],
): CheckpointCheck {
  const c = signed?.checkpoint;
  if (
    !c ||
    c.v !== 1 ||
    typeof c.chain_id !== "string" ||
    !Number.isSafeInteger(c.height) ||
    c.height < 0 ||
    typeof c.tip_hash !== "string" ||
    typeof c.signer !== "string"
  ) {
    return { ok: false, code: "MALFORMED" };
  }
  let hash: string;
  try {
    hash = digestCanonical(c);
  } catch {
    return { ok: false, code: "MALFORMED" };
  }
  if (hash !== signed.checkpoint_hash) return { ok: false, code: "HASH_MISMATCH" };
  if (!trustedSigners.includes(c.signer)) return { ok: false, code: "UNTRUSTED_SIGNER" };
  if (!verifyCanonical(c.signer, c, signed.signature)) return { ok: false, code: "SIGNATURE_INVALID" };
  return { ok: true };
}

function witnessStatement(checkpointHash: string) {
  return { type: "phoenix-fortress.witness.v1", checkpoint_hash: checkpointHash };
}

/** A peer countersigns a checkpoint it has independently verified. */
export function countersign(witness: Signer, signed: SignedCheckpoint): WitnessSignature {
  return {
    witness: witness.keyId,
    checkpoint_hash: signed.checkpoint_hash,
    signature: signCanonical(witness, witnessStatement(signed.checkpoint_hash)),
  };
}

export function verifyWitness(
  sig: WitnessSignature,
  checkpointHash: string,
  trustedWitnesses: readonly string[],
): boolean {
  if (sig.checkpoint_hash !== checkpointHash) return false;
  if (!trustedWitnesses.includes(sig.witness)) return false;
  return verifyCanonical(sig.witness, witnessStatement(checkpointHash), sig.signature);
}
