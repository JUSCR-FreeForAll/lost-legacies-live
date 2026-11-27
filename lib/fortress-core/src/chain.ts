import { randomBytes } from "node:crypto";
import {
  CANONICALIZATION,
  SUPPORTED_CANONICALIZATIONS,
  ZERO_REF,
  canonicalize,
  digestCanonical,
  sha256Hex,
  sha256Ref,
} from "./canonical";

export const CHAIN_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_BLOCK_VERSIONS: readonly number[] = [1];
export const GENESIS_POLICY = "deterministic-manifest-v1" as const;

export interface ChainManifest {
  chain_id: string;
  schema_version: number;
  canonicalization: string;
  genesis_policy: string;
  trust_key: string;
}

export type BlockMeta = Record<string, unknown>;

export interface BlockBody {
  v: number;
  idx: number;
  event_id: string;
  occurred_at_us: number;
  event_type: string;
  actor_id: string;
  object_ref: string;
  prev_hash: string;
  idempotency_key_hash: string;
  meta: BlockMeta;
}

export interface Block extends BlockBody {
  hash: string;
}

export type ChainFailureCode =
  | "GENESIS_MISSING"
  | "GENESIS_MISMATCH"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "UNSUPPORTED_CANONICALIZATION"
  | "UNSUPPORTED_BLOCK_VERSION"
  | "INDEX_GAP"
  | "PREDECESSOR_MISMATCH"
  | "HASH_MISMATCH"
  | "MALFORMED_BLOCK"
  | "CHECKPOINT_CONTRADICTION"
  | "CHECKPOINT_BEYOND_TIP";

export class ChainVerificationError extends Error {
  constructor(
    readonly code: ChainFailureCode,
    readonly idx: number | null,
  ) {
    super(`${code}${idx === null ? "" : ` at idx ${idx}`}`);
  }
}

export function buildManifest(input: {
  installationName: string;
  trustKey: string;
  scope?: string;
}): ChainManifest {
  const base = `${input.installationName}\u0000${input.trustKey}`;
  const root = `pf:${sha256Hex(base).slice(0, 32)}`;
  return {
    chain_id: input.scope ? `${root}/${input.scope}` : root,
    schema_version: CHAIN_SCHEMA_VERSION,
    canonicalization: CANONICALIZATION,
    genesis_policy: GENESIS_POLICY,
    trust_key: input.trustKey,
  };
}

function uuidFromDigest(hex: string): string {
  const h = hex.slice(0, 32).split("");
  h[12] = "8"; // RFC 9562 version 8 (custom / name-based)
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** RFC 9562 UUIDv7: time-ordered, random tail. */
export function uuidv7(nowMs = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(nowMs, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const s = bytes.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export function hashBlock(body: BlockBody): string {
  const { v, idx, event_id, occurred_at_us, event_type, actor_id, object_ref, prev_hash, idempotency_key_hash, meta } = body;
  return sha256Ref(
    canonicalize({ v, idx, event_id, occurred_at_us, event_type, actor_id, object_ref, prev_hash, idempotency_key_hash, meta }),
  );
}

/** Genesis is a pure function of the manifest: no clock, no randomness. */
export function genesisBlock(manifest: ChainManifest): Block {
  const body: BlockBody = {
    v: 1,
    idx: 0,
    event_id: uuidFromDigest(sha256Hex(`genesis\u0000${manifest.chain_id}`)),
    occurred_at_us: 0,
    event_type: "GENESIS",
    actor_id: "system:genesis",
    object_ref: digestCanonical(manifest),
    prev_hash: ZERO_REF,
    idempotency_key_hash: ZERO_REF,
    meta: { ...manifest },
  };
  return { ...body, hash: hashBlock(body) };
}

export function nextBlock(
  prev: Pick<Block, "idx" | "hash">,
  input: {
    eventType: string;
    actorId: string;
    objectRef?: string;
    idempotencyKey?: string | null;
    meta?: BlockMeta;
    occurredAtUs?: number;
    eventId?: string;
  },
): Block {
  const occurred = input.occurredAtUs ?? Date.now() * 1000;
  const body: BlockBody = {
    v: 1,
    idx: prev.idx + 1,
    event_id: input.eventId ?? uuidv7(Math.floor(occurred / 1000)),
    occurred_at_us: occurred,
    event_type: input.eventType,
    actor_id: input.actorId,
    object_ref: input.objectRef ?? ZERO_REF,
    prev_hash: prev.hash,
    idempotency_key_hash: input.idempotencyKey ? sha256Ref(input.idempotencyKey) : ZERO_REF,
    meta: input.meta ?? {},
  };
  assertNoSecretMaterial(body.meta);
  return { ...body, hash: hashBlock(body) };
}

export interface CheckpointLike {
  height: number;
  tip_hash: string;
  chain_id: string;
}

export interface ChainReport {
  height: number;
  tip: string;
  blocks: number;
}

/**
 * Full fail-closed verification. Throws ChainVerificationError on the first
 * failure. `checkpoints` must already be signature-verified by the caller.
 */
export function verifyChain(
  manifest: ChainManifest,
  blocks: readonly Block[],
  checkpoints: readonly CheckpointLike[] = [],
): ChainReport {
  if (manifest.schema_version !== CHAIN_SCHEMA_VERSION) {
    throw new ChainVerificationError("UNSUPPORTED_SCHEMA_VERSION", null);
  }
  if (!SUPPORTED_CANONICALIZATIONS.includes(manifest.canonicalization)) {
    throw new ChainVerificationError("UNSUPPORTED_CANONICALIZATION", null);
  }
  const first = blocks[0];
  if (!first || first.idx !== 0) throw new ChainVerificationError("GENESIS_MISSING", 0);
  const expectedGenesis = genesisBlock(manifest);
  if (canonicalize(first) !== canonicalize(expectedGenesis)) {
    throw new ChainVerificationError("GENESIS_MISMATCH", 0);
  }
  let prev: Block = first;
  for (let i = 1; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    if (!SUPPORTED_BLOCK_VERSIONS.includes(block.v)) {
      throw new ChainVerificationError("UNSUPPORTED_BLOCK_VERSION", block.idx);
    }
    if (
      typeof block.idx !== "number" ||
      typeof block.hash !== "string" ||
      typeof block.meta !== "object" ||
      block.meta === null ||
      !Number.isSafeInteger(block.occurred_at_us)
    ) {
      throw new ChainVerificationError("MALFORMED_BLOCK", i);
    }
    if (block.idx !== prev.idx + 1) throw new ChainVerificationError("INDEX_GAP", block.idx);
    if (block.prev_hash !== prev.hash) throw new ChainVerificationError("PREDECESSOR_MISMATCH", block.idx);
    let recomputed: string;
    try {
      recomputed = hashBlock(block);
    } catch {
      throw new ChainVerificationError("MALFORMED_BLOCK", block.idx);
    }
    if (recomputed !== block.hash) throw new ChainVerificationError("HASH_MISMATCH", block.idx);
    prev = block;
  }
  for (const cp of checkpoints) {
    if (cp.chain_id !== manifest.chain_id) throw new ChainVerificationError("CHECKPOINT_CONTRADICTION", cp.height);
    const at = blocks[cp.height];
    if (!at) throw new ChainVerificationError("CHECKPOINT_BEYOND_TIP", cp.height);
    if (at.hash !== cp.tip_hash) throw new ChainVerificationError("CHECKPOINT_CONTRADICTION", cp.height);
  }
  return { height: prev.idx, tip: prev.hash, blocks: blocks.length };
}

const SECRET_KEY = /(secret|password|passphrase|private|seed|plaintext|recovery_?key|recoverykey|recovery_?code|recoverycode|^token$|bearer)/i;
const SECRET_VALUE = [
  /pf_[A-Za-z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}\b/, // recovery-code shape
];

/** Returns a path to the first secret-shaped key or value, or null. */
export function findSecretMaterial(value: unknown, path = "$"): string | null {
  if (typeof value === "string") {
    return SECRET_VALUE.some((re) => re.test(value)) ? path : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findSecretMaterial(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) return `${path}.${k}`;
      const hit = findSecretMaterial(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

export function assertNoSecretMaterial(meta: unknown): void {
  const hit = findSecretMaterial(meta);
  if (hit) throw new Error(`SECRET_MATERIAL_IN_LEDGER:${hit}`);
}
