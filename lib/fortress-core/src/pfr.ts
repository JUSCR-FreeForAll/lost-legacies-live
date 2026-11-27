import { canonicalBytes, canonicalize, sha256Hex } from "./canonical";
import { ChainVerificationError, verifyChain, type Block, type ChainManifest } from "./chain";
import { verifyCheckpoint, type SignedCheckpoint } from "./checkpoint";
import { openBytes, type CiphertextEnvelope } from "./envelope";
import { signCanonical, verifyCanonical, type Signer } from "./signatures";
import { readTar, writeTar } from "./tar";

export const PFR_FORMAT = "phoenix-fortress-recovery" as const;
export const PFR_VERSION = 1 as const;
export const SUPPORTED_PFR_VERSIONS: readonly number[] = [1];

export interface PfrVaultItem {
  id: string;
  kind: "backup" | "evidence";
  context: string;
  checksum: string;
  bytes: number;
  created_at: string;
  label: string;
  ciphertext: CiphertextEnvelope;
  wrapped_data_key: CiphertextEnvelope;
}

export interface PfrManifest {
  format: typeof PFR_FORMAT;
  version: number;
  created_at_us: number;
  chain_id: string;
  signer: string;
  recovery_key_fingerprint: string | null;
  encryption: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
}

const VERIFY_TXT = `PHOENIX FORTRESS RECOVERY PACKAGE (.pfr)
========================================

EN: This file is a POSIX tar archive. It contains encrypted data, a hash-chained
audit ledger and a signed checkpoint. Nothing in it is readable without the
recovery key that was shown to the owner once during setup.

Verify offline (no network needed):
  node pfr-verify.mjs <package.pfr> --trust-key <ed25519:...>
Decrypt offline into a NEW empty folder (never over your live data):
  node pfr-verify.mjs <package.pfr> --recovery-key-file <file> --out <empty-folder>

What verification proves: files were not altered after signing, the ledger is
internally consistent and matches the signed checkpoint. What it does NOT
prove: that the signing key was not compromised, or legal admissibility.

ES: Este archivo es un paquete tar POSIX. Contiene datos cifrados, un registro
de auditoria encadenado por hash y un punto de control firmado. Nada es legible
sin la clave de recuperacion que se mostro una sola vez al propietario.

Verificar sin conexion:
  node pfr-verify.mjs <paquete.pfr> --trust-key <ed25519:...>
Descifrar sin conexion en una carpeta NUEVA y vacia (nunca sobre datos en uso):
  node pfr-verify.mjs <paquete.pfr> --recovery-key-file <archivo> --out <carpeta-vacia>

La verificacion demuestra que los archivos no se alteraron despues de firmarse
y que el registro coincide con el punto de control firmado. NO demuestra que la
clave de firma no haya sido comprometida, ni validez legal.
`;

export function buildPfr(
  signer: Signer,
  input: {
    chainManifest: ChainManifest;
    blocks: readonly Block[];
    checkpoint: SignedCheckpoint;
    items: readonly PfrVaultItem[];
    recoveryKeyFingerprint: string | null;
    createdAtUs?: number;
  },
): Buffer {
  const backups = input.items.filter((i) => i.kind === "backup");
  const evidence = input.items.filter((i) => i.kind === "evidence");
  const files: Array<{ path: string; data: Buffer }> = [
    { path: "ledger/manifest.json", data: canonicalBytes(input.chainManifest) },
    { path: "ledger/blocks.jsonl", data: Buffer.from(input.blocks.map((b) => canonicalize(b)).join("\n") + "\n", "utf8") },
    { path: "ledger/checkpoint.json", data: canonicalBytes({ checkpoint: input.checkpoint.checkpoint, checkpoint_hash: input.checkpoint.checkpoint_hash }) },
    { path: "ledger/checkpoint.sig", data: Buffer.from(input.checkpoint.signature, "utf8") },
    { path: "vault/backups.enc", data: canonicalBytes(backups) },
    { path: "vault/evidence.enc", data: canonicalBytes(evidence) },
    { path: "VERIFY.txt", data: Buffer.from(VERIFY_TXT, "utf8") },
  ];
  const manifest: PfrManifest = {
    format: PFR_FORMAT,
    version: PFR_VERSION,
    created_at_us: input.createdAtUs ?? Date.now() * 1000,
    chain_id: input.chainManifest.chain_id,
    signer: signer.keyId,
    recovery_key_fingerprint: input.recoveryKeyFingerprint,
    encryption: "AES-256-GCM per-item data key, wrapped by the owner recovery key",
    files: files.map((f) => ({ path: f.path, sha256: sha256Hex(f.data), bytes: f.data.length })),
  };
  return writeTar([
    { path: "manifest.json", data: canonicalBytes(manifest) },
    { path: "manifest.sig", data: Buffer.from(signCanonical(signer, manifest), "utf8") },
    ...files,
  ]);
}

export interface PfrReport {
  ok: boolean;
  version: number | null;
  signer: string | null;
  signerTrusted: boolean;
  chainHeight: number | null;
  tipHash: string | null;
  items: number;
  failures: string[];
  warnings: string[];
}

export interface OpenedPfr {
  manifest: PfrManifest;
  chainManifest: ChainManifest;
  blocks: Block[];
  checkpoint: SignedCheckpoint;
  items: PfrVaultItem[];
}

function parseJson<T>(buf: Buffer | undefined, failures: string[], name: string): T | null {
  if (!buf) {
    failures.push(`MISSING_FILE:${name}`);
    return null;
  }
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    failures.push(`MALFORMED_FILE:${name}`);
    return null;
  }
}

/**
 * Verify a package fully offline. `trustedKeys` pins the expected signer; when
 * empty the package is checked for internal consistency only and a warning is
 * returned, because a self-asserted signer proves nothing about origin.
 */
export function verifyPfr(
  archive: Buffer,
  trustedKeys: readonly string[] = [],
): { report: PfrReport; opened: OpenedPfr | null } {
  const failures: string[] = [];
  const warnings: string[] = [];
  const report: PfrReport = {
    ok: false, version: null, signer: null, signerTrusted: false, chainHeight: null,
    tipHash: null, items: 0, failures, warnings,
  };
  let entries: Map<string, Buffer>;
  try {
    entries = readTar(archive);
  } catch (err) {
    failures.push((err as Error).message);
    return { report, opened: null };
  }
  const manifest = parseJson<PfrManifest>(entries.get("manifest.json"), failures, "manifest.json");
  const sig = entries.get("manifest.sig")?.toString("utf8");
  if (!manifest || !sig) {
    if (!sig) failures.push("MISSING_FILE:manifest.sig");
    return { report, opened: null };
  }
  report.version = manifest.version;
  report.signer = manifest.signer;
  if (manifest.format !== PFR_FORMAT || !SUPPORTED_PFR_VERSIONS.includes(manifest.version)) {
    failures.push("UNSUPPORTED_PACKAGE_VERSION");
    return { report, opened: null };
  }
  if (!verifyCanonical(manifest.signer, manifest, sig)) failures.push("MANIFEST_SIGNATURE_INVALID");
  report.signerTrusted = trustedKeys.includes(manifest.signer);
  if (trustedKeys.length && !report.signerTrusted) failures.push("UNTRUSTED_SIGNER");
  if (!trustedKeys.length) warnings.push("NO_TRUST_KEY_PINNED: signer is self-asserted; pass --trust-key to pin it.");
  const listed = new Set<string>();
  for (const f of manifest.files ?? []) {
    listed.add(f.path);
    const data = entries.get(f.path);
    if (!data) failures.push(`MISSING_FILE:${f.path}`);
    else if (sha256Hex(data) !== f.sha256 || data.length !== f.bytes) failures.push(`FILE_HASH_MISMATCH:${f.path}`);
  }
  for (const name of entries.keys()) {
    if (name !== "manifest.json" && name !== "manifest.sig" && !listed.has(name)) failures.push(`UNLISTED_FILE:${name}`);
  }
  const chainManifest = parseJson<ChainManifest>(entries.get("ledger/manifest.json"), failures, "ledger/manifest.json");
  const cpFile = parseJson<Omit<SignedCheckpoint, "signature">>(entries.get("ledger/checkpoint.json"), failures, "ledger/checkpoint.json");
  const cpSig = entries.get("ledger/checkpoint.sig")?.toString("utf8") ?? "";
  const blocksRaw = entries.get("ledger/blocks.jsonl")?.toString("utf8");
  const backups = parseJson<PfrVaultItem[]>(entries.get("vault/backups.enc"), failures, "vault/backups.enc") ?? [];
  const evidence = parseJson<PfrVaultItem[]>(entries.get("vault/evidence.enc"), failures, "vault/evidence.enc") ?? [];
  let blocks: Block[] = [];
  if (blocksRaw === undefined) failures.push("MISSING_FILE:ledger/blocks.jsonl");
  else {
    try {
      blocks = blocksRaw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Block);
    } catch {
      failures.push("MALFORMED_FILE:ledger/blocks.jsonl");
    }
  }
  if (!chainManifest || !cpFile) return { report, opened: null };
  const checkpoint: SignedCheckpoint = { ...cpFile, signature: cpSig };
  if (chainManifest.chain_id !== manifest.chain_id) failures.push("CHAIN_ID_MISMATCH");
  const cpCheck = verifyCheckpoint(checkpoint, [manifest.signer]);
  if (!cpCheck.ok) failures.push(`CHECKPOINT_${cpCheck.code}`);
  try {
    const chain = verifyChain(chainManifest, blocks, [checkpoint.checkpoint]);
    report.chainHeight = chain.height;
    report.tipHash = chain.tip;
    if (chainManifest.trust_key !== manifest.signer) failures.push("TRUST_KEY_MISMATCH");
  } catch (err) {
    failures.push(err instanceof ChainVerificationError ? `CHAIN_${err.message}` : "CHAIN_UNVERIFIABLE");
  }
  const items = [...backups, ...evidence];
  report.items = items.length;
  const committed = new Set(blocks.map((b) => b.object_ref));
  for (const item of items) {
    if (!committed.has(`sha256:${item.checksum}`)) failures.push(`ITEM_NOT_IN_LEDGER:${item.id}`);
  }
  report.ok = failures.length === 0;
  return { report, opened: { manifest, chainManifest, blocks, checkpoint, items } };
}

/** Decrypt every item with the recovery key. Throws on wrong key or tampering. */
export function decryptPfrItems(
  opened: OpenedPfr,
  recoveryKey: Buffer,
): Array<{ item: PfrVaultItem; plaintext: Buffer }> {
  return opened.items.map((item) => ({
    item,
    plaintext: openBytes(item.ciphertext, item.wrapped_data_key, recoveryKey, item.context, item.checksum),
  }));
}
