import { z } from "zod";

export const platformEnum = z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE"]);

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: z.string().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const captionConfigSchema = z.object({
  template: z.string().max(5000).optional(),
  addHashtags: z.array(z.string().max(100)).max(50).optional(),
  removeHashtags: z.array(z.string().max(100)).max(50).optional(),
  prefix: z.string().max(500).optional(),
  suffix: z.string().max(500).optional(),
  findReplace: z
    .array(z.object({ find: z.string().max(200), replace: z.string().max(500) }))
    .max(20)
    .optional(),
});

export const conditionsSchema = z.object({
  minDurationSec: z.number().int().min(0).max(86400).optional(),
  maxDurationSec: z.number().int().min(0).max(86400).optional(),
  publishedAfter: z.string().datetime().optional(),
  includeKeywords: z.array(z.string().max(100)).max(50).optional(),
  excludeKeywords: z.array(z.string().max(100)).max(50).optional(),
  onlyVertical: z.boolean().optional(),
  excludePostIds: z.array(z.string().max(100)).max(500).optional(),
  allowedDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  allowedHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(24) }).optional(),
});

export const scheduleConfigSchema = z.object({
  window: z
    .object({
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(1).max(24),
      days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    })
    .optional(),
  specific: z.object({ at: z.string().datetime() }).optional(),
  queue: z.object({ spacingMinutes: z.number().int().min(1).max(10080) }).optional(),
});

export const targetSchema = z.object({
  accountId: z.string().min(1),
  platform: platformEnum,
  captionMode: z.enum(["KEEP_ORIGINAL", "CUSTOM", "TEMPLATE"]).default("KEEP_ORIGINAL"),
  captionConfig: captionConfigSchema.optional(),
  visibility: z.enum(["public", "unlisted", "private"]).default("public"),
  extraDelaySec: z.number().int().min(0).max(604800).default(0),
});

export const automationSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(false),
  sourceAccountId: z.string().min(1),
  sourcePlatform: platformEnum,
  executionMode: z.enum(["AUTOMATIC", "APPROVAL_REQUIRED"]).default("APPROVAL_REQUIRED"),
  scheduleMode: z.enum(["IMMEDIATE", "FIXED_DELAY", "SCHEDULED_WINDOW", "SPECIFIC_TIME", "QUEUE"]).default("IMMEDIATE"),
  delaySeconds: z.number().int().min(0).max(2592000).default(0),
  scheduleConfig: scheduleConfigSchema.optional(),
  conditions: conditionsSchema.optional(),
  targets: z.array(targetSchema).min(1, "Add at least one destination").max(10),
});

export const assetInitSchema = z.object({
  originalName: z.string().min(1).max(300),
  mimeType: z.string().regex(/^video\/(mp4|quicktime|webm|x-msvideo|mov)$/, "Unsupported video type"),
  sizeBytes: z.number().int().min(1).max(2 * 1024 * 1024 * 1024), // 2 GB cap
  contentHash: z.string().max(128).optional(),
  title: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
  detectedPostId: z.string().optional(),
});

export const captionTemplateSchema = z.object({
  name: z.string().min(1).max(120),
  platform: platformEnum.optional(),
  body: z.string().min(1).max(5000),
  isDefault: z.boolean().default(false),
});

export const prefsSchema = z.object({
  timezone: z.string().min(1).max(100).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  emailNotifications: z.boolean().optional(),
  notifyOnPublish: z.boolean().optional(),
  notifyOnFailure: z.boolean().optional(),
  notifyOnApproval: z.boolean().optional(),
  notifyOnDisconnect: z.boolean().optional(),
});

export type AutomationInput = z.infer<typeof automationSchema>;
