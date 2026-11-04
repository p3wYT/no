// Route-handler helpers: auth gating, Zod body parsing, uniform errors.
import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import type { User } from "@prisma/client";

export function json(data: unknown, init?: number | ResponseInit) {
  const responseInit = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data as any, responseInit);
}

export function error(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }
  try {
    return schema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) {
      throw new ApiError("Validation failed", 422, { issues: e.flatten() });
    }
    throw e;
  }
}

export class ApiError extends Error {
  constructor(message: string, public status = 400, public extra?: Record<string, unknown>) {
    super(message);
  }
}

type AuthedHandler = (ctx: { req: NextRequest; user: User; params: Record<string, string> }) => Promise<Response>;

export function withAuth(handler: AuthedHandler) {
  return async (req: NextRequest, context: { params: Promise<Record<string, string>> }) => {
    try {
      const user = await getSessionUser();
      if (!user) return error("Unauthorized", 401);
      const params = context?.params ? await context.params : {};
      return await handler({ req, user, params });
    } catch (e) {
      if (e instanceof ApiError) return error(e.message, e.status, e.extra);
      logger.error({ err: e }, "unhandled route error");
      return error("Internal server error", 500);
    }
  };
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
