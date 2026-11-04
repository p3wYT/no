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

# Against a deployed environment (creates and then deletes its own test user):
SMOKE_BASE_URL=https://your-app npm run smoke

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
- **Storage**: `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY` reference the Railway bucket (`${{media.ENDPOINT}}`
  etc.), plus `S3_FORCE_PATH_STYLE=false`. The worker applies the bucket's CORS
  rule (your `APP_URL` origin) on startup.
- **Platforms**: each service references shared variables
  (`GOOGLE_CLIENT_ID=${{shared.GOOGLE_CLIENT_ID}}`, …). Enter the real values
  once under **Project → Settings → Shared Variables** in the Railway dashboard
  (seal the secrets). Until then each platform shows *Setup required*.

> `ENCRYPTION_KEY` must never change after accounts are connected — stored OAuth
> tokens are encrypted with it.

Scheduled jobs persist in Redis and survive restarts; the worker's `scheduler`
sweep re-enqueues any due job after a redeploy.

### Object storage
Production uses a **Railway Storage Bucket** (`media`): private, S3-compatible,
encrypted at rest, wired to both services by variable reference. To use
**Cloudflare R2** instead:

1. Cloudflare dashboard → R2 → **Create bucket** (e.g. `repostflow-media`).
2. R2 → **Manage API tokens** → create a token with *Object Read & Write* on
   that bucket. Note the Access Key ID, Secret Access Key and the account's
   S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. Bucket → Settings → **CORS policy** (browser uploads use presigned PUTs):
   ```json
   [{"AllowedOrigins":["https://YOUR_APP_URL"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["content-type"],"MaxAgeSeconds":3600}]
   ```
4. Replace the five `S3_*` variables on both `web` and `worker` with the R2 values.

## Platform developer-app setup

For each platform, create an app, add the OAuth redirect URI
`https://YOUR_APP_URL/api/connect/<platform>/callback`, and set the credentials.

### YouTube (Google)
Callback URL: `https://YOUR_APP_URL/api/connect/youtube/callback`

1. **Project** — [console.cloud.google.com](https://console.cloud.google.com) →
   project picker → **New project** (e.g. `RepostFlow`).
2. **API** — APIs & Services → Library → **YouTube Data API v3** → Enable.
3. **Consent screen** — Google Auth Platform → **Branding**: app name, support
   email, app home page (`https://YOUR_APP_URL`), authorized domain
   (`up.railway.app` or your custom domain), developer contact email.
4. **Audience** — User type **External**. While in *Testing*, add the Google
   accounts that own your channels as **Test users** (max 100).
5. **Data access** — add scopes `.../auth/youtube.upload` and
   `.../auth/youtube.readonly`. Nothing else is needed.
6. **Client** — Clients → **Create client** → *Web application*. Authorized
   redirect URI: the callback URL above (exact match, https). No JavaScript
   origins needed. Create, then copy the **Client ID** and **Client secret**.
7. **Railway** — Project → Settings → **Shared Variables**: add
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (seal the secret), then deploy
   the staged change. Both services already reference them.
8. **Connect** — sign in to RepostFlow → Connected Accounts → *Connect YouTube*.

Limits to know: in *Testing*, refresh tokens expire after 7 days (reconnect
weekly) and only test users can connect. Moving to *In production* requires
Google's OAuth verification for these sensitive scopes. Until the project passes
the **YouTube API Services audit**, `videos.insert` uploads are locked to
**private**; RepostFlow reports that on the job instead of claiming a public
post. Default quota is 10,000 units/day (an upload ≈ 1,600).

### Instagram (Meta)
Callback URL: `https://YOUR_APP_URL/api/connect/instagram/callback`

RepostFlow implements **"API setup with Facebook Login"** (Instagram API with
Facebook Login): the Facebook login dialog with `scope=`, Facebook User access
tokens, Pages-based account discovery, and publishing through
`graph.facebook.com`. It does **not** implement "API setup with Instagram Login"
(`instagram_business_*` scopes, `graph.instagram.com`) or Facebook Login for
Business (`config_id`, system-user tokens). A Meta app can only have one API
setup, so choose this one when adding the use case.

1. [developers.facebook.com](https://developers.facebook.com) -> **Create app**
   -> use case **Manage messaging & content on Instagram** (app type
   *Business*).
2. In the use case, choose **API setup with Facebook login**.
3. **Facebook Login settings** -> *Valid OAuth Redirect URIs*: the callback URL
   above, exactly. Leave *Client OAuth Login* and *Web OAuth Login* on.
4. **App settings -> Basic**: add your *App domains* (`up.railway.app` or your
   custom domain) and a Privacy Policy URL.
5. **Credentials**: use the **Meta App ID and App Secret** from *App settings ->
   Basic*, not any separate "Instagram app ID". Enter them as the shared
   variables `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` in Railway (seal the
   secret).
6. **Roles**: while the app is in Development mode only people with a role on
   the app (Admin/Developer/Tester) can connect. Add the accounts you will test
   with, and accept the invitations.
7. The Instagram account must be **Business or Creator**, and linked to a
   **Facebook Page** that the connecting person can manage.

Permissions requested: `instagram_basic`, `instagram_content_publish`,
`pages_show_list`, `pages_read_engagement`, `business_management`. Publishing is
only enabled for an account if every one except `business_management` was
actually granted in the consent dialog. Going live for people without an app
role requires Meta **App Review** (advanced access) for these permissions and
Business Verification.

Behavior to know: one login connects *every* Instagram account reachable
through your Pages. Access tokens last ~60 days; the worker renews them
automatically starting 14 days before expiry and warns you if renewal fails.
Limit: 100 API-published posts per rolling 24 hours. The Graph API version is
pinned in `src/lib/providers/instagram.ts` (`GRAPH_VERSION`).

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
