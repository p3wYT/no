// Shared ioredis connection factory for BullMQ.
import { Redis, type RedisOptions } from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

// BullMQ requires maxRetriesPerRequest: null on the connection it uses.
// lazyConnect so importing these modules (e.g. during `next build`) never
// opens a socket or requires REDIS_URL to be present yet.
const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  // Railway private networking can be IPv6; family 0 resolves both.
  family: 0,
};

export function createRedis(): Redis {
  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  return new Redis(url, baseOptions);
}

// Shared connection for queue producers (safe to reuse).
export const redis: Redis =
  globalForRedis.redis ?? createRedis();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
