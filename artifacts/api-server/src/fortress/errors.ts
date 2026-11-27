import type { ErrorRequestHandler } from "express";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "SESSION_REVOKED"
  | "CONFLICT"
  | "FORBIDDEN"
  | "CONSENT_REQUIRED"
  | "INTEGRITY_FAILURE"
  | "RECOVERY_REQUIRED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "PERSISTENCE_UNAVAILABLE"
  | "RECOVERY_KEY_INVALID"
  | "RECOVERY_KEY_NOT_ACTIVE"
  | "RECOVERY_CODE_INVALID"
  | "ENCRYPTION_KEY_UNAVAILABLE"
  | "ENCRYPTION_KEY_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "CHECKPOINT_CONTRADICTION"
  | "REPLAY_REJECTED"
  | "ADAPTER_REJECTED"
  | "NOT_READY"
  | "SECRET_ALREADY_ISSUED"
  | "PROVIDER_REVOCATION_FAILED"
  | "SESSION_CHECK_UNAVAILABLE"
  | "INTERNAL_ERROR";

/** Audit event to commit in a separate transaction after the failing one rolls back. */
export interface FailureAudit {
  tenantId: string;
  actorId: string;
  eventType: string;
  meta: Record<string, unknown>;
}

export class ApiError extends Error {
  audit: FailureAudit | null = null;
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
  withAudit(audit: FailureAudit): this {
    this.audit = audit;
    return this;
  }
}

export const fail = (status: number, code: ApiErrorCode, message: string) =>
  new ApiError(status, code, message);

const PG_UNAVAILABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "57P01", "57P03", "08000", "08003", "08006", "53300"]);

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code: ApiErrorCode = "INTERNAL_ERROR";
  let message = "The service could not complete this request.";
  if (err instanceof ApiError) {
    status = err.status;
    code = err.code;
    message = err.message;
  } else if ((err as { type?: string })?.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "Request body is too large.";
  } else if ((err as { type?: string })?.type === "entity.parse.failed") {
    status = 400;
    code = "BAD_REQUEST";
    message = "Request body is not valid JSON.";
  } else if (PG_UNAVAILABLE.has(String((err as { code?: string })?.code))) {
    status = 503;
    code = "PERSISTENCE_UNAVAILABLE";
    message = "The database is unavailable. No changes were made.";
  } else if ((err as Error)?.message === "ENCRYPTION_KEY_UNAVAILABLE" || (err as Error)?.message === "ENCRYPTION_KEY_INVALID") {
    status = 503;
    code = (err as Error).message as ApiErrorCode;
    message = "The server encryption key is unavailable or invalid. Operations are paused.";
  }
  if (status >= 500) req.log?.error({ code, err: err instanceof ApiError ? undefined : (err as Error)?.message }, "Phoenix Fortress request failed");
  else req.log?.warn({ code }, "Phoenix Fortress request rejected");
  res.status(status).json({ error: message, code, requestId: String(req.id ?? "") });
};
