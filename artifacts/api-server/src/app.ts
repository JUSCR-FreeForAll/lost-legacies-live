import express, { type Express, type Router as ExpressRouter } from "express";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { logger } from "./lib/logger";
import { requireUser, resolveTenant, type AuthProvider, type SessionRevoker } from "./fortress/auth";
import { errorHandler } from "./fortress/errors";
import coreRouter from "./routes/fortress/core";
import { helperRouter, recoveryRouter } from "./routes/fortress/recovery";
import protectionRouter from "./routes/fortress/protection";
import { credentialAdminRouter, credentialApiRouter } from "./routes/fortress/credentials";
import resilienceRouter from "./routes/fortress/resilience";
import interopRouter from "./routes/fortress/interop";
import { diagnosticsRouter, healthRouter } from "./routes/fortress/diagnostics";

export interface AppOptions {
  authProvider: AuthProvider;
  sessionRevoker: SessionRevoker;
  /** Mount Clerk's middleware and proxy (off in tests, which use a header-driven provider). */
  clerk?: boolean;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  const services = { sessionRevoker: options.sessionRevoker };

  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  if (options.clerk) app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

  // No CORS middleware: the web app and API share an origin through the proxy.
  app.use(express.json({ limit: "512kb" }));

  if (options.clerk) {
    app.use(
      clerkMiddleware((req) => ({
        publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
      })),
    );
  }

  const api: ExpressRouter = express.Router();
  api.use(healthRouter);
  // Bearer-credential endpoints authenticate the credential, never a session.
  api.use(credentialApiRouter);

  // Recovery contacts approve requests for someone else's tenant: signed in, no tenant resolution.
  api.use("/v1/helper", requireUser(options.authProvider));
  api.use(helperRouter());

  const tenant: ExpressRouter = express.Router();
  tenant.use(requireUser(options.authProvider), resolveTenant);
  tenant.use(coreRouter);
  tenant.use(recoveryRouter(services));
  tenant.use(protectionRouter);
  tenant.use(credentialAdminRouter);
  tenant.use(resilienceRouter);
  tenant.use(interopRouter);
  tenant.use(diagnosticsRouter(services));
  api.use(tenant);

  app.use("/api", api);
  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Not found.", code: "NOT_FOUND", requestId: String(req.id ?? "") });
  });
  app.use(errorHandler);
  return app;
}
