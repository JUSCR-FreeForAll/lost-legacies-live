import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { handler, type Services } from "../../fortress/http";
import { readiness } from "../../fortress/integrity";
import { encryptionStatus, getSigner, signingKeySource } from "../../fortress/keys";
import { outboxStatus } from "../../fortress/outbox";
import { EVIDENCE_REL, GATES, computeSourceHash, findRepoRoot, type EvidenceFile } from "../../fortress/gates";

function loadEvidence(): { file: string; evidence: EvidenceFile } | null {
  const root = findRepoRoot();
  if (!root) return null;
  const file = path.join(root, EVIDENCE_REL);
  if (!existsSync(file)) return null;
  try {
    return { file: EVIDENCE_REL, evidence: JSON.parse(readFileSync(file, "utf8")) as EvidenceFile };
  } catch {
    return null;
  }
}

interface GateOut {
  id: string;
  phase: string;
  title: string;
  critical: boolean;
  status: "pass" | "fail" | "not_run" | "stale" | "not_verified";
  source: "live" | "evidence" | "manual";
  detail: string;
}

export async function buildDiagnostics(services: Services) {
  const ready = await readiness();
  const enc = encryptionStatus();
  const loaded = loadEvidence();
  const currentSourceHash = computeSourceHash();
  const fresh = Boolean(loaded && currentSourceHash && loaded.evidence.sourceHash === currentSourceHash);

  const gates: GateOut[] = GATES.map((g): GateOut => {
    if (g.kind === "manual") {
      return { id: g.id, phase: g.phase, title: g.title, critical: g.critical, status: "not_verified" as const, source: "manual" as const,
        detail: "Needs a human review. Not claimed as passed." };
    }
    const tests = loaded?.evidence.tests.filter((t) => t.gates.includes(g.id)) ?? [];
    if (!loaded || tests.length === 0) {
      return { id: g.id, phase: g.phase, title: g.title, critical: g.critical, status: "not_run" as const, source: "evidence" as const,
        detail: loaded ? "No recorded test covers this gate." : "No test evidence recorded yet." };
    }
    const failed = tests.filter((t) => !t.ok);
    const status = failed.length ? "fail" as const : fresh ? "pass" as const : "stale" as const;
    const detail = failed.length
      ? `${failed.length} of ${tests.length} test(s) failed: ${failed.map((t) => t.name).join("; ")}`
      : fresh
        ? `${tests.length} test(s) passed on ${loaded.evidence.ranAt}.`
        : `${tests.length} test(s) passed on ${loaded.evidence.ranAt}, but code changed since. Re-run the suite.`;
    return { id: g.id, phase: g.phase, title: g.title, critical: g.critical, status, source: "evidence" as const, detail };
  });

  // Live gates: these reflect this running server, not the test run.
  const trust = ready.checks.find((c) => c.name === "trust_key");
  gates.unshift(
    { id: "L-READY", phase: "mvp", title: "This server is ready (verification passed, no open conditions)", critical: true,
      status: ready.status === "ready" ? "pass" : "fail", source: "live", detail: ready.status },
    { id: "L-KEK", phase: "mvp", title: "Server encryption key is configured", critical: true,
      status: enc === "configured" ? "pass" : "fail", source: "live", detail: enc },
    { id: "L-TRUST", phase: "mvp", title: "Checkpoint signing key matches the pinned installation key", critical: true,
      status: trust?.ok === false ? "fail" : trust ? "pass" : "not_run", source: "live", detail: trust?.detail ?? "not checked" },
  );

  const publishable = ready.status === "ready" && gates.filter((g) => g.critical).every((g) => g.status === "pass");
  return {
    readiness: ready,
    encryption: enc,
    signingKey: `${getSigner().keyId} (${signingKeySource()})`,
    sessionRevoker: services.sessionRevoker.name,
    outbox: outboxStatus() as unknown as Record<string, unknown>,
    gates,
    latestTests: loaded
      ? {
          ranAt: loaded.evidence.ranAt, passed: loaded.evidence.passed, failed: loaded.evidence.failed,
          sourceHash: loaded.evidence.sourceHash, currentSourceHash, database: loaded.evidence.database,
          runtime: loaded.evidence.runtime, file: loaded.file,
        }
      : null,
    // Only a run against the deployed service could set this; this server never claims it.
    productionVerified: false,
    publishable,
    limitations: [
      "Passkeys/WebAuthn are delegated to the sign-in provider (Clerk); Fortress does not enroll authenticators itself.",
      "Solana anchors are recorded as unverified: Fortress never contacts the network to confirm them.",
      "Seamcraft support uses a provisional envelope (0.1-provisional) because no published specification was available.",
      "The accessibility review (G13) is manual and is not claimed as passed.",
      "Production has not been verified by this suite; results come from the separate test database.",
    ],
  };
}

export function diagnosticsRouter(services: Services): IRouter {
  const router: IRouter = Router();
  router.get("/v1/diagnostics", handler(async (_req, res) => {
    res.json(await buildDiagnostics(services));
  }));
  return router;
}

/** Public liveness and readiness. Readiness is 503 unless verification passed. */
export const healthRouter: IRouter = Router();
healthRouter.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});
healthRouter.get("/readyz", handler(async (_req, res) => {
  const r = await readiness();
  res.status(r.status === "ready" ? 200 : 503).json(r);
}));
