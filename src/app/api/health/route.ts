import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

// Railway health check endpoint. Verifies DB + Redis connectivity.
export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "down";
    healthy = false;
  }
  try {
    await redis.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "down";
    healthy = false;
  }
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, time: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
