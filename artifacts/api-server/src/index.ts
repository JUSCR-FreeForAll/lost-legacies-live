import { createApp } from "./app";
import { logger } from "./lib/logger";
import { clerkAuthProvider, clerkSessionRevoker } from "./fortress/clerk";
import { startupVerification } from "./fortress/integrity";
import { startOutboxExporter } from "./fortress/outbox";
import { startRevocationRetry } from "./fortress/sessions";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const app = createApp({ authProvider: clerkAuthProvider, sessionRevoker: clerkSessionRevoker, clerk: true });

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  // Liveness is up immediately; readiness stays NOT_READY (and writes are
  // refused) until startup verification succeeds. Failures are retried.
  const attempt = async (): Promise<void> => {
    if (await startupVerification()) {
      startOutboxExporter();
      startRevocationRetry(clerkSessionRevoker);
      return;
    }
    setTimeout(() => void attempt(), 30_000).unref();
  };
  void attempt();
});
