/**
 * Runs the Phoenix Fortress acceptance suite against the separate test
 * database and records the results as evidence for the diagnostics page.
 *
 *   pnpm --filter @workspace/api-server run test:fortress
 *
 * The evidence file stores the hash of the source it ran against, so the
 * diagnostics page marks gates stale as soon as the code changes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { EVIDENCE_REL, GATES, computeSourceHash, findRepoRoot, gateIdsIn, type EvidenceFile, type EvidenceTest } from "../src/fortress/gates";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = ["core.test.ts", "mvp.test.ts", "phases.test.ts"].map((f) => path.join(here, f));
const root = findRepoRoot(here);
if (!root) throw new Error("repository root not found");
const sourceHash = computeSourceHash(root);
if (!sourceHash) throw new Error("source hash unavailable");

const results: EvidenceTest[] = [];
const stream = run({ files, concurrency: 1, execArgv: ["--import", "tsx"] });
stream.on("test:pass", (e) => {
  if (e.details.type !== "suite" && e.nesting === 0) results.push({ name: e.name, gates: gateIdsIn(e.name), ok: true });
});
stream.on("test:fail", (e) => {
  if (e.details.type !== "suite" && e.nesting === 0) results.push({ name: e.name, gates: gateIdsIn(e.name), ok: false });
});
stream.compose(spec).pipe(process.stdout);

await new Promise<void>((resolve) => stream.once("end", () => resolve()));

// Only real test cases count (file-level wrappers are reported without gate tags and without a [ID]).
const tests = results.filter((t) => !files.some((f) => t.name === f));
const failed = tests.filter((t) => !t.ok).length;
const evidence: EvidenceFile = {
  ranAt: new Date().toISOString(),
  passed: tests.length - failed,
  failed,
  sourceHash,
  database: "fortress_test (separate PostgreSQL database, truncated before every test)",
  runtime: `node ${process.version}`,
  tests,
};
const out = path.join(root, EVIDENCE_REL);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);

const uncovered = GATES.filter((g) => g.kind === "automated" && !tests.some((t) => t.ok && t.gates.includes(g.id)));
process.stdout.write(`\nEvidence written to ${EVIDENCE_REL}: ${evidence.passed} passed, ${failed} failed.\n`);
if (uncovered.length) process.stdout.write(`Automated gates without a passing test: ${uncovered.map((g) => g.id).join(", ")}\n`);
process.exitCode = failed > 0 || uncovered.length > 0 || tests.length === 0 ? 1 : 0;
