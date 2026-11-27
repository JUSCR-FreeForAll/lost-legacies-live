// Builds the standalone offline verifier as a single dependency-free file.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const dir = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(dir, "src/cli/verify.ts")],
  outfile: path.join(dir, "../../dist/offline-verifier/pfr-verify.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "// Phoenix Fortress offline verifier. No network access. See VERIFY.txt in any .pfr package." },
  logLevel: "info",
});
