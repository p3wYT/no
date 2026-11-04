// Simple fixed-window rate limiter backed by Redis.
import { redis } from "@/lib/redis";

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; remaining: number }> {
  const redisKey = `rl:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSec);
    return { ok: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    // Fail open on Redis hiccups rather than blocking the user.
    return { ok: true, remaining: limit };
  }
}
