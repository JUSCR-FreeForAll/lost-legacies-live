/**
 * pfr-verify: standalone offline verifier for Phoenix Fortress recovery packages.
 *
 *   node pfr-verify.mjs <package.pfr> [--trust-key ed25519:...] [--json]
 *   node pfr-verify.mjs <package.pfr> --trust-key ed25519:... \
 *        --recovery-key-file <file> --out <new-empty-dir>
 *
 * Makes no network calls. Exit codes: 0 verified, 1 verification failed,
 * 2 usage error, 3 decryption failed (wrong key or tampered ciphertext).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decryptPfrItems, verifyPfr } from "../pfr";

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function runVerifier(argv: string[], out: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): number {
  const file = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1]!.startsWith("--")));
  if (!file) {
    out("usage: pfr-verify <package.pfr> [--trust-key ed25519:...] [--recovery-key-file f --out dir] [--json]");
    return 2;
  }
  const trust = arg("--trust-key", argv);
  const keyFile = arg("--recovery-key-file", argv);
  const outDir = arg("--out", argv);
  const json = argv.includes("--json");
  let archive: Buffer;
  try {
    archive = readFileSync(file);
  } catch {
    out(`cannot read ${file}`);
    return 2;
  }
  const { report, opened } = verifyPfr(archive, trust ? [trust] : []);
  if (json) out(JSON.stringify(report));
  else {
    out(`package version : ${report.version ?? "unknown"}`);
    out(`signer          : ${report.signer ?? "unknown"} ${report.signerTrusted ? "(pinned)" : "(NOT pinned)"}`);
    out(`ledger height   : ${report.chainHeight ?? "unverified"}`);
    out(`ledger tip      : ${report.tipHash ?? "unverified"}`);
    out(`vault items     : ${report.items}`);
    for (const w of report.warnings) out(`warning         : ${w}`);
    for (const f of report.failures) out(`FAILURE         : ${f}`);
    out(report.ok ? "RESULT: VERIFIED" : "RESULT: REJECTED");
  }
  if (!report.ok || !opened) return 1;
  if (keyFile || outDir) {
    if (!keyFile || !outDir) {
      out("--recovery-key-file and --out must be given together");
      return 2;
    }
    if (existsSync(outDir) && readdirSync(outDir).length > 0) {
      out("refusing to write: --out must be a new or empty directory (never overwrite live data)");
      return 2;
    }
    const key = Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64");
    if (key.length !== 32) {
      out("recovery key file must contain the 32-byte base64 key shown at setup");
      return 2;
    }
    let decrypted;
    try {
      decrypted = decryptPfrItems(opened, key);
    } catch {
      out("DECRYPTION FAILED: wrong recovery key or tampered ciphertext. Nothing was written.");
      return 3;
    } finally {
      key.fill(0);
    }
    mkdirSync(outDir, { recursive: true });
    for (const { item, plaintext } of decrypted) {
      const safe = `${item.kind}-${item.id.replace(/[^A-Za-z0-9-]/g, "")}.json`;
      writeFileSync(path.join(outDir, safe), plaintext, { flag: "wx" });
    }
    out(`decrypted ${decrypted.length} items into ${outDir}`);
  }
  return 0;
}

const invokedDirectly = typeof process !== "undefined" && process.argv[1] && /pfr-verify|cli[\\/]verify/.test(process.argv[1]);
if (invokedDirectly) {
  process.exitCode = runVerifier(process.argv.slice(2));
}
