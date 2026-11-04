// Runtime environment validation (Zod). Fails fast on misconfiguration.
// Secrets are server-side only; this module must never be imported by client
// components.

import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1")
  .optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // When true, provider integrations use in-memory mock implementations.
  // Allowed ONLY outside production. Guarded below.
  DEMO_MODE: bool,

  DATABASE_URL: z.string().url().or(z.string().startsWith("postgres")),
  REDIS_URL: z.string().min(1),

  APP_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().default(3000),

  // 32+ char secret for session signing.
  AUTH_SECRET: z.string().min(16),
  // 32-byte key, base64 or hex, for AES-256-GCM token encryption.
  ENCRYPTION_KEY: z.string().min(16),

  // Provider OAuth credentials (optional — absence => provider shows
  // "Setup required" rather than faking a connection).
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Object storage (S3 / R2).
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),

  // Optional SMTP for email notifications.
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

export type AppEnv = z.infer<typeof schema> & {
  demo: boolean;
  storageConfigured: boolean;
  providers: {
    tiktok: boolean;
    instagram: boolean;
    youtube: boolean;
  };
};

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;

  const demo = !!e.DEMO_MODE;
  if (demo && e.NODE_ENV === "production") {
    throw new Error(
      "DEMO_MODE must never be enabled in production. Refusing to start.",
    );
  }

  cached = {
    ...e,
    demo,
    storageConfigured: !!(e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY),
    providers: {
      tiktok: !!(e.TIKTOK_CLIENT_KEY && e.TIKTOK_CLIENT_SECRET),
      instagram: !!(e.INSTAGRAM_APP_ID && e.INSTAGRAM_APP_SECRET),
      youtube: !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    },
  };
  return cached;
}

/** Safe accessor for the public app URL without importing the whole env. */
export function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}
