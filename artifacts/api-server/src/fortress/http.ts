import type { NextFunction, Request, RequestHandler, Response } from "express";
import { fail } from "./errors";
import type { SessionRevoker } from "./auth";

export function handler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}

export function parseBody<T>(
  schema: { safeParse: (body: unknown) => { success: boolean; data?: T } },
  req: Request,
): T {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || parsed.data === undefined) throw fail(400, "BAD_REQUEST", "Request body is invalid.");
  return parsed.data;
}

export function parseId(req: Request, name = "id"): string {
  const raw = req.params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw fail(400, "BAD_REQUEST", "Identifier is invalid.");
  }
  return value;
}

export interface Ctx {
  tenantId: string;
  userId: string;
  sessionId: string | null;
  role: "admin" | "operator";
  isOwner: boolean;
}

export function ctx(res: Response): Ctx {
  return {
    tenantId: res.locals.tenantId as string,
    userId: res.locals.userId as string,
    sessionId: (res.locals.sessionId as string | null) ?? null,
    role: res.locals.role as "admin" | "operator",
    isOwner: Boolean(res.locals.isOwner),
  };
}

export const iso = (value: Date | string | null | undefined): string | null =>
  value ? (value instanceof Date ? value : new Date(value)).toISOString() : null;

export const isoReq = (value: Date | string): string => iso(value)!;

export interface Services {
  sessionRevoker: SessionRevoker;
}
