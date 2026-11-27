/**
 * Test environment. Imported first by every test so @workspace/db binds to the
 * separate test database, never the development one. Keys are random per run.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const base = process.env.FORTRESS_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is required to derive the test database URL");
const url = new URL(base);
url.pathname = "/fortress_test";
process.env.DATABASE_URL = url.toString();
process.env.BACKUP_ENCRYPTION_KEY = process.env.FORTRESS_TEST_KEK ?? randomBytes(32).toString("hex");
process.env.FORTRESS_TEST_KEK = process.env.BACKUP_ENCRYPTION_KEY;
delete process.env.FORTRESS_SIGNING_SEED;
process.env.FORTRESS_INSTALLATION_NAME = "fortress-test";
process.env.FORTRESS_ARCHIVE_DIR = mkdtempSync(path.join(os.tmpdir(), "pf-archive-"));
process.env.NODE_ENV = "production"; // plain JSON logs, no pretty transport worker
process.env.LOG_LEVEL = "silent";
