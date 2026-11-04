# RepostFlow

Cloud-native, fully automated cross-platform video publishing. Connect TikTok,
Instagram and YouTube; RepostFlow detects new videos on your authorized
accounts and re-publishes them to your other platforms according to automation
rules — scheduling, caption transforms, conditions and duplicate/loop
protection — entirely server-side. **Nothing depends on your computer being on.**

> **Honesty first.** RepostFlow never simulates a successful publish and never
> shows a fake connected account. Where a platform's official API cannot
> publish for your app tier (e.g. an unaudited TikTok app), it shows an accurate
> **Draft / handoff** or **Setup required** state instead of pretending.

---

## Architecture

```
┌────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│  Next.js web    │────▶│  PostgreSQL (Prisma)      │◀────│  Worker (BullMQ) │
│  (App Router,   │     │  users, accounts, assets, │     │  detect, match,  │
│   API routes,   │     │  automations, jobs, …     │     │  process, publish│
│   dashboard)    │     └──────────────────────────┘     │  reconcile, cron │
└───────┬────────┘                 ▲                       └────────┬────────┘
        │                          │                                │
        │                   ┌──────┴───────┐                        │
        └──────────────────▶│   Redis       │◀───────────────────────┘
                            │  (BullMQ queues)                        
                            └──────────────┘        ┌─────────────────────────┐
                                                    │  S3 / R2 object storage   │
                                 original media ───▶│  (durable video bytes)    │
                                                    └─────────────────────────┘
```

- **Web service** — Next.js 15 (App Router), React 19, Tailwind, Radix UI.
  Auth, dashboard, REST API, OAuth connect/callback. `/api/health` for Railway.
- **Worker service** — same image, runs `src/worker/index.ts`. Owns all polling,
  scheduling, media probing, publishing, reconciliation and maintenance via
  **BullMQ**. Has its own `/health` HTTP endpoint.
- **PostgreSQL** — all durable state (Prisma schema in `prisma/schema.prisma`).
- **Redis** — BullMQ persistent queues; scheduled jobs survive redeploys.
- **S3 / R2** — original video bytes. Never the ephemeral Railway filesystem.

### The engine (pure, fully unit-tested — `src/lib/core/`)
`captions.ts` (templates, hashtags, prefix/suffix, find-replace, per-platform
limits), `rules.ts` (condition evaluation), `scheduling.ts` (immediate / delay /
window / specific-time / queue, timezone + DST aware), `dedupe.ts` (idempotency
keys + loop/lineage), `jobState.ts` (publish state machine), `matching.ts`
(associating detected posts with original assets), `platform.ts` (real limits).

---

## Tech stack

Next.js 15 · React 19 · TypeScript · Tailwind + Radix · Prisma 6 / PostgreSQL ·
Redis + BullMQ · Zod · AES-256-GCM token encryption · argon2 · AWS SDK v3
(S3/R2) · FFmpeg · Vitest.

---

## Local development

```bash
# 1. Install
npm install

# 2. Start Postgres + Redis (any method). Then configure env:
cp .env.example .env
#   set DATABASE_URL, REDIS_URL, AUTH_SECRET, ENCRYPTION_KEY
#   for a no-credentials demo: set DEMO_MODE=true

# 3. Database
npx prisma migrate dev
npm run db:seed            # optional: demo@repostflow.local / demopassword

# 4. Run (two processes)
npm run dev                # web  → http://localhost:3000
npm run worker:dev         # background worker
```

### Demo mode
`DEMO_MODE=true` swaps in in-memory mock providers so you can exercise the whole
pipeline (connect → detect → automate → schedule → publish) with zero platform
credentials. It is **forbidden in production** — the app refuses to boot with
`NODE_ENV=production` and `DEMO_MODE` set.

---

## Testing

```bash
npm test                   # 55 unit tests (engine, crypto, SSRF) — no services needed
npm run typecheck          # tsc --noEmit
npm run lint
npm run build              # production build

# Full pipeline against a real Postgres + Redis, in demo mode:
npm run test:integration
```

The integration test (`tests/integration/flow.test.ts`) signs up a user,
connects three demo accounts, creates an automation, detects source videos,
fans them out to publish jobs, supplies an asset, publishes, and asserts the
correct final statuses — plus idempotency and loop protection.

---

## Railway deployment

RepostFlow runs as **two services built from this one repo/Dockerfile**, plus
Railway PostgreSQL and Redis, plus S3-compatible storage (Cloudflare R2).
Railway's config-as-code (`railway.json`) is deprecated for new services, so
service settings live in Railway itself:

| Service | Start command | Pre-deploy | Health check |
|---|---|---|---|
| `web` | `npm run start` | `npx prisma migrate deploy` | `/api/health` (DB + Redis) |
| `worker` | `npm run start:worker` | — | `/health` (Redis) |

Variables (production environment):
- **Shared**: `NODE_ENV=production`, `DEMO_MODE=false`, `APP_URL` (public https
  web domain), `AUTH_SECRET`, `ENCRYPTION_KEY`, `TIKTOK_AUDITED=false`.
- **Per service**: `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
  `REDIS_URL=${{Redis.REDIS_URL}}` (private network), `PORT` (web 3000,
  worker 8080), plus references to the shared values.
- **Storage (R2)**: `S3_ENDPOINT`, `S3_REGION=auto`, `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` on both services.
- **Platforms**: OAuth credentials on both services as they become available.

> `ENCRYPTION_KEY` must never change after accounts are connected — stored OAuth
> tokens are encrypted with it.

Scheduled jobs persist in Redis and survive restarts; the worker's `scheduler`
sweep re-enqueues any due job after a redeploy.

### Cloudflare R2 setup
1. Cloudflare dashboard → R2 → **Create bucket** (e.g. `repostflow-media`).
2. R2 → **Manage API tokens** → create a token with *Object Read & Write* on
   that bucket. Note the Access Key ID, Secret Access Key and the account's
   S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. Bucket → Settings → **CORS policy** (browser uploads use presigned PUTs):
   ```json
   [{"AllowedOrigins":["https://YOUR_APP_URL"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["content-type"],"MaxAgeSeconds":3600}]
   ```
4. Set the five `S3_*` variables on both `web` and `worker` in Railway.

## Platform developer-app setup

For each platform, create an app, add the OAuth redirect URI
`https://YOUR_APP_URL/api/connect/<platform>/callback`, and set the credentials.

### YouTube (Google)
1. Google Cloud Console → new project → enable **YouTube Data API v3**.
2. OAuth consent screen (External); add scopes `youtube.upload`,
   `youtube.readonly`.
3. Create OAuth client (Web). Redirect URI: `.../api/connect/youtube/callback`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
5. Quota: uploads cost ~1,600 units of the default 10,000/day. Request more if
   needed. New apps may have uploads defaulted to *private* until API audit.

### Instagram (Meta)
1. developers.facebook.com → create app (Business).
2. Add **Instagram** + **Facebook Login**; request `instagram_basic`,
   `instagram_content_publish`, `pages_show_list`, `business_management`.
3. Redirect URI: `.../api/connect/instagram/callback`.
4. Set `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`.
5. **Only Instagram Business/Creator accounts linked to a Facebook Page can
   publish.** Personal accounts connect read-only — the UI says so. App Review
   is required for publishing scopes in production.

### TikTok
1. developers.tiktok.com → create app; add **Login Kit** + **Content Posting
   API**. Scopes: `user.info.basic`, `video.list`, `video.upload`,
   `video.publish`.
2. Redirect URI: `.../api/connect/tiktok/callback`.
3. Set `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.
4. **Unaudited apps can only create private content.** RepostFlow therefore
   uploads to the creator's TikTok **inbox/drafts** (the compliant
   draft/handoff flow) and never claims a public post. After TikTok approves
   your Content Posting API **audit**, set `TIKTOK_AUDITED=true` to enable
   direct public posting where the creator permits.

---

## Capability & limitation matrix

| Capability | Status |
|---|---|
| Core engine (captions, rules, scheduling, dedupe, state machine, matching) | ✅ **Implemented + unit-tested** |
| Auth, sessions, encrypted tokens, SSRF guard, rate limiting | ✅ **Implemented + tested** |
| Automation engine, fan-out, idempotent publish jobs, loop protection | ✅ **Implemented + integration-tested (demo)** |
| BullMQ workers, scheduler, reconciliation, graceful shutdown, health | ✅ **Implemented + smoke-tested** |
| Full dashboard (overview, automations, library, queue, calendar, accounts, activity, settings, onboarding) | ✅ **Implemented** |
| Object storage uploads (presigned S3/R2) + FFmpeg probing | ✅ **Implemented** (needs `S3_*` to exercise) |
| YouTube connect / detect / upload (Data API v3) | 🟡 **Implemented, awaiting Google OAuth credentials** |
| Instagram connect / detect / publish (Graph API, Business/Creator) | 🟡 **Implemented, awaiting Meta app + review** |
| TikTok connect / detect | 🟡 **Implemented, awaiting TikTok credentials** |
| TikTok **public** direct-post | 🟠 **Awaiting TikTok audit** — draft/handoff until then (by design) |
| Instagram publishing from **personal** accounts | 🔴 **Unsupported by the official API** — surfaced as a clear message |
| Downloading originals from TikTok/YouTube | 🔴 **Not provided by the APIs** — use the media library + matching instead |

Legend: ✅ done & tested · 🟡 implemented, needs credentials · 🟠 needs platform
approval · 🔴 not possible via official APIs (handled honestly).

---

## Exact remaining actions to go live

1. Provision Railway Postgres + Redis and an S3/R2 bucket; set all env vars.
2. Create the three developer apps above and add the OAuth credentials.
3. Deploy the **web** and **worker** services (start commands above).
4. Submit Instagram app for App Review (publishing scopes) and TikTok for the
   Content Posting API audit; set `TIKTOK_AUDITED=true` once granted.
5. Connect your accounts in-app, upload originals, build an automation, enable.

No fabricated credentials, no fake success states. What isn't live yet is
labeled accurately in the UI and above.

---

## Security

Official OAuth only (users never enter platform passwords). OAuth **state +
PKCE**; tokens **AES-256-GCM encrypted at rest**; sessions are random tokens
stored only as SHA-256 hashes in httpOnly/secure/sameSite cookies; per-resource
ownership checks on every route; Zod validation on all input; **SSRF guard** on
any remote media URL; Redis rate limiting; token-redacting structured logs;
account deletion with full cascade.

## License

MIT
