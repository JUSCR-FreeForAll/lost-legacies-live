import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface GateDefinition {
  id: string;
  phase: "mvp" | "protection" | "resilience" | "interoperability" | "external_proof";
  title: string;
  critical: boolean;
  /** automated: proven by tests tagged [id]; manual: needs a human review. */
  kind: "automated" | "manual";
}

/**
 * Acceptance gates from the architecture's "Phased roadmap and verification
 * gates" section, plus one gate per later-phase guarantee. Tests prove a gate
 * by putting "[<id>]" in their name.
 */
export const GATES: GateDefinition[] = [
  { id: "G01", phase: "mvp", title: "Fresh installation produces the deterministic expected genesis", critical: true, kind: "automated" },
  { id: "G02", phase: "mvp", title: "Offline boot reaches READY without network access", critical: true, kind: "automated" },
  { id: "G03", phase: "mvp", title: "Tampered block makes verification fail closed (RECOVERY_REQUIRED)", critical: true, kind: "automated" },
  { id: "G04", phase: "mvp", title: "Rewritten ledger is detected by a trusted checkpoint contradiction", critical: true, kind: "automated" },
  { id: "G05", phase: "mvp", title: "Concurrent commits: no duplicate index, no lost block", critical: true, kind: "automated" },
  { id: "G06", phase: "mvp", title: "Request replay causes no second mutation", critical: true, kind: "automated" },
  { id: "G07", phase: "mvp", title: "Crash before archive export: outbox resumes safely", critical: true, kind: "automated" },
  { id: "G08", phase: "mvp", title: "Lost device: reserve recovery code restores control", critical: true, kind: "automated" },
  { id: "G09", phase: "mvp", title: "Stolen device: sessions and credentials revoked", critical: true, kind: "automated" },
  { id: "G10", phase: "mvp", title: "Ransomware drill: offline .pfr package verifies and restores", critical: true, kind: "automated" },
  { id: "G11", phase: "mvp", title: "Bad backup: restoration rejected", critical: true, kind: "automated" },
  { id: "G12", phase: "mvp", title: "Secret scan: no plaintext protected secret at rest or in the ledger", critical: true, kind: "automated" },
  { id: "G13", phase: "mvp", title: "Accessibility review of the recovery path (keyboard and assistive tech)", critical: false, kind: "manual" },
  { id: "G14", phase: "mvp", title: "Safe mode: no covert tracking or forced disclosure", critical: true, kind: "automated" },
  { id: "P2-1", phase: "protection", title: "Recovery contacts need quorum and the delay; owner can cancel", critical: true, kind: "automated" },
  { id: "P2-2", phase: "protection", title: "Consent registry blocks every gated action until granted", critical: true, kind: "automated" },
  { id: "P2-3", phase: "protection", title: "Evidence is encrypted and crypto-shredded on delete", critical: true, kind: "automated" },
  { id: "P2-4", phase: "protection", title: "English and Spanish message catalogs cover the same IDs", critical: false, kind: "automated" },
  { id: "P3-1", phase: "resilience", title: "Witness countersignatures verify only for registered witnesses", critical: true, kind: "automated" },
  { id: "P3-2", phase: "resilience", title: "External checkpoint import detects contradictions", critical: true, kind: "automated" },
  { id: "P3-3", phase: "resilience", title: "Revocation CRDT: revocation always wins, merges never grant", critical: true, kind: "automated" },
  { id: "P4-1", phase: "interoperability", title: "JSON-LD uses RDFC-1.0 and never fetches remote contexts", critical: true, kind: "automated" },
  { id: "P4-2", phase: "interoperability", title: "Seamcraft envelopes need a trusted signed sender; replays rejected", critical: true, kind: "automated" },
  { id: "P4-3", phase: "interoperability", title: "JUSCR ingest through a write-only credential is idempotent", critical: true, kind: "automated" },
  { id: "P5-1", phase: "external_proof", title: "Anchors contain nothing personal and require consent", critical: true, kind: "automated" },
  { id: "P5-2", phase: "external_proof", title: "Startup and recovery never require Solana", critical: true, kind: "automated" },
];

export function findRepoRoot(start = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const HASHED_DIRS = [
  "artifacts/api-server/src",
  "artifacts/api-server/tests",
  "lib/fortress-core/src",
  "lib/db/src/schema",
  "lib/api-spec/openapi.yaml",
];

function walk(p: string, out: string[]): void {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isFile()) {
    out.push(p);
    return;
  }
  for (const name of readdirSync(p).sort()) {
    if (name === "node_modules" || name === "dist") continue;
    walk(path.join(p, name), out);
  }
}

/** Hash of the code the evidence was produced from. Null when sources are not present (deployed bundle). */
export function computeSourceHash(root = findRepoRoot()): string | null {
  if (!root) return null;
  const files: string[] = [];
  for (const rel of HASHED_DIRS) walk(path.join(root, rel), files);
  if (!files.length) return null;
  const h = createHash("sha256");
  for (const f of files) {
    h.update(path.relative(root, f));
    h.update("\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return `sha256:${h.digest("hex")}`;
}

export interface EvidenceTest {
  name: string;
  gates: string[];
  ok: boolean;
}

export interface EvidenceFile {
  ranAt: string;
  passed: number;
  failed: number;
  sourceHash: string;
  database: string;
  runtime: string;
  tests: EvidenceTest[];
}

export const EVIDENCE_REL = "docs/phoenix-fortress/evidence/latest.json";

export function gateIdsIn(name: string): string[] {
  return [...name.matchAll(/\[([A-Z0-9-]+)\]/g)].map((m) => m[1]!).filter((id) => GATES.some((g) => g.id === id));
}
