import { withAuth, json, parseBody } from "@/lib/api";
import { buildCaption, buildTitle } from "@/lib/core/captions";
import { captionConfigSchema, platformEnum } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  platform: platformEnum,
  mode: z.enum(["KEEP_ORIGINAL", "CUSTOM", "TEMPLATE"]),
  config: captionConfigSchema.optional(),
  sample: z
    .object({
      originalCaption: z.string().max(5000).default("New edit is finally out 🔥 #anime"),
      title: z.string().max(300).optional(),
      sourcePlatform: z.string().default("TikTok"),
      sourceUsername: z.string().default("creator"),
    })
    .optional(),
});

// Live caption preview for the automation builder.
export const POST = withAuth(async ({ req }) => {
  const body = await parseBody(req, schema);
  const sample = body.sample ?? {
    originalCaption: "New edit is finally out 🔥 #anime",
    sourcePlatform: "TikTok",
    sourceUsername: "creator",
  };
  const ctx = {
    originalCaption: sample.originalCaption ?? "New edit is finally out 🔥 #anime",
    title: sample.title,
    sourcePlatform: sample.sourcePlatform ?? "TikTok",
    sourceUsername: sample.sourceUsername ?? "creator",
    now: new Date(),
    timezone: "UTC",
  };
  const config = { mode: body.mode, ...(body.config ?? {}) };
  const caption = buildCaption(body.platform, config as any, ctx);
  const title = buildTitle(body.platform, config as any, ctx);
  return json({ caption, title });
});
