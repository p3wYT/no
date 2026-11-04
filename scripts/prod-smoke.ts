// Post-deploy smoke test. Exercises the PUBLIC deployment exactly as a user
// would (no DB access, no test-only endpoints), then deletes everything it
// created, including its own account.
//
//   SMOKE_BASE_URL=https://your-app npx tsx scripts/prod-smoke.ts
//
// Requires ffmpeg (present in the production image) to generate a real video.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = (process.env.SMOKE_BASE_URL || process.env.APP_URL || "").replace(/\/$/, "");
if (!BASE) throw new Error("Set SMOKE_BASE_URL (or APP_URL)");

let cookie = "";
let failures = 0;
const results: string[] = [];

function record(ok: boolean, name: string, detail = "") {
  if (!ok) failures++;
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  results.push(line);
  console.log(line);
}

async function call(p: string, init: RequestInit & { auth?: boolean } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  if (init.auth !== false && cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${p}`, { ...init, headers, redirect: "manual" });
  const set = res.headers.getSetCookie?.() ?? [];
  const session = set.find((c) => c.startsWith("rf_session="));
  if (session) cookie = session.split(";")[0];
  const text = await res.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : undefined; } catch { /* html */ }
  return { res, body, text };
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Smoke testing ${BASE}`);
  const workdir = mkdtempSync(path.join(tmpdir(), "rf-smoke-"));
  let assetId: string | null = null;
  let signedUp = false;

  try {
    // ---- Platform health ---------------------------------------------------
    const health = await call("/api/health", { auth: false });
    record(health.res.status === 200 && health.body?.checks?.database === "ok" && health.body?.checks?.redis === "ok",
      "health: database + redis", JSON.stringify(health.body?.checks));

    const home = await call("/", { auth: false });
    record(home.res.status === 200 && home.text.includes("RepostFlow"), "landing page renders");

    const unauth = await call("/api/accounts", { auth: false });
    record(unauth.res.status === 401, "API rejects unauthenticated requests", `status ${unauth.res.status}`);

    const gate = await call("/overview", { auth: false });
    record([302, 307].includes(gate.res.status) && (gate.res.headers.get("location") || "").includes("/login"),
      "dashboard redirects anonymous users to /login");

    // ---- Auth --------------------------------------------------------------
    const email = `smoke-${Date.now()}-${randomBytes(3).toString("hex")}@repostflow.invalid`;
    const password = randomBytes(18).toString("base64url");
    const signup = await call("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password, name: "Smoke Test" }) });
    signedUp = signup.res.status === 201;
    record(signedUp && !!cookie, "signup creates account + session", `status ${signup.res.status}`);
    const cookieFlags = (signup.res.headers.getSetCookie?.() ?? []).join(";").toLowerCase();
    record(cookieFlags.includes("httponly") && cookieFlags.includes("secure") && cookieFlags.includes("samesite=lax"),
      "session cookie is HttpOnly + Secure + SameSite=Lax");

    await call("/api/auth/logout", { method: "POST" });
    cookie = "";
    const badLogin = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "wrong-password" }) });
    record(badLogin.res.status === 401, "login rejects wrong password");
    const login = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    record(login.res.status === 200 && !!cookie, "login with correct password");

    // ---- Dashboard ---------------------------------------------------------
    for (const page of ["/overview", "/automations", "/automations/new", "/library", "/queue", "/calendar", "/accounts", "/activity", "/settings"]) {
      const r = await call(page);
      record(r.res.status === 200, `page ${page}`, `status ${r.res.status}`);
    }
    const overview = await call("/api/overview");
    record(overview.res.status === 200 && typeof overview.body?.stats?.accounts === "number", "overview stats API");

    const settings = await call("/api/settings", { method: "PATCH", body: JSON.stringify({ timezone: "America/New_York" }) });
    record(settings.res.status === 200 && settings.body?.preferences?.timezone === "America/New_York", "settings persist");

    // ---- Provider capability reporting -------------------------------------
    const accounts = await call("/api/accounts");
    const caps: any[] = accounts.body?.capabilities ?? [];
    record(caps.length === 3 && caps.every((c) => c.demo === false), "providers reported, demo mode OFF",
      caps.map((c) => `${c.platform}=${c.configured ? "configured" : "setup-required"}`).join(", "));
    for (const c of caps) {
      const r = await call(`/api/connect/${c.platform.toLowerCase()}`);
      const loc = r.res.headers.get("location") || "";
      if (c.configured) {
        record([302, 307].includes(r.res.status) && /^https:\/\/(accounts\.google\.com|www\.facebook\.com|www\.tiktok\.com)\//.test(loc),
          `connect ${c.platform} redirects to the official consent page`, new URL(loc).host);
      } else {
        record([302, 307].includes(r.res.status) && loc.includes("error=not_configured"),
          `connect ${c.platform} without credentials fails gracefully`);
      }
    }

    // ---- Automations (validation; real creation needs a connected account) --
    const auto = await call("/api/automations", {
      method: "POST",
      body: JSON.stringify({ name: "smoke", sourceAccountId: "does-not-exist", sourcePlatform: "TIKTOK",
        targets: [{ accountId: "also-missing", platform: "YOUTUBE" }] }),
    });
    record(auto.res.status === 404, "automation API validates account ownership", `status ${auto.res.status}`);
    const preview = await call("/api/preview-caption", {
      method: "POST",
      body: JSON.stringify({ platform: "YOUTUBE", mode: "TEMPLATE", config: { template: "{{original_caption}} #shorts", addHashtags: ["edit"] } }),
    });
    record(preview.res.status === 200 && preview.body?.caption?.text?.includes("#shorts"), "caption preview engine", preview.body?.caption?.text);

    // ---- Media: upload → verify → process → retrieve → delete --------------
    const video = path.join(workdir, "smoke.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30",
      "-t", "3", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", "-y", video]);
    const bytes = readFileSync(video);
    const hash = sha256(bytes);

    const init = await call("/api/assets", {
      method: "POST",
      body: JSON.stringify({ originalName: "smoke.mp4", mimeType: "video/mp4", sizeBytes: bytes.length, contentHash: hash, title: "Smoke test video" }),
    });
    assetId = init.body?.asset?.id ?? null;
    record(init.res.status === 201 && !!init.body?.uploadUrl && init.body?.storageConfigured === true,
      "upload init returns presigned URL (storage configured)");
    const uploadUrl: string = init.body?.uploadUrl;

    if (uploadUrl) {
      const origin = new URL(BASE).origin;
      const pre = await fetch(uploadUrl, { method: "OPTIONS", headers: {
        Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" } });
      const acao = pre.headers.get("access-control-allow-origin");
      record(acao === origin || acao === "*", "bucket CORS allows browser uploads from the app", `ACAO=${acao}`);

      const wrong = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4" }, body: bytes.subarray(0, 1000) });
      record(!wrong.ok, "presigned URL rejects a different file size", `status ${wrong.status}`);

      const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4" }, body: bytes });
      record(put.ok, "direct upload to bucket", `status ${put.status}, ${bytes.length} bytes`);

      const done = await call(`/api/assets/${assetId}/complete`, { method: "POST", body: JSON.stringify({ contentHash: hash }) });
      record(done.res.status === 200, "complete verifies object exists in bucket", `status ${done.res.status}`);

      // Worker probes the file with ffprobe via BullMQ.
      let asset: any = null;
      for (let i = 0; i < 30; i++) {
        const list = await call("/api/assets");
        asset = (list.body?.assets ?? []).find((a: any) => a.id === assetId);
        if (asset?.probed) break;
        await sleep(3000);
      }
      record(!!asset?.probed && Math.abs((asset.durationSec ?? 0) - 3) < 0.5 && asset.width === 1080 && asset.height === 1920 && asset.aspectRatio === "9:16",
        "worker processed video (ffprobe)", asset ? `${asset.durationSec}s ${asset.width}x${asset.height} ${asset.aspectRatio}` : "not probed");

      const dl = await call(`/api/assets/${assetId}/download`);
      const signed = dl.res.headers.get("location") || "";
      record(dl.res.status === 302 && signed.startsWith("https://"), "download redirects to presigned URL");
      if (signed) {
        const got = Buffer.from(await (await fetch(signed)).arrayBuffer());
        record(sha256(got) === hash, "retrieved file is byte-identical", `${got.length} bytes`);
      }
      const otherUser = await call(`/api/assets/${assetId}/download`, { auth: false });
      record(otherUser.res.status === 401, "download requires authentication");

      const del = await call(`/api/assets/${assetId}`, { method: "DELETE" });
      record(del.res.status === 200, "delete asset");
      if (signed) {
        const gone = await fetch(signed);
        record(gone.status === 404 || gone.status === 403, "deleted file is gone from bucket", `status ${gone.status}`);
      }
      assetId = del.res.status === 200 ? null : assetId;
    }

    // ---- Background worker evidence -----------------------------------------
    const activity = await call("/api/activity");
    record(activity.res.status === 200, "activity feed API");
  } catch (err) {
    record(false, "unexpected error", (err as Error).stack ?? String(err));
  } finally {
    if (assetId) await call(`/api/assets/${assetId}`, { method: "DELETE" }).catch(() => undefined);
    if (signedUp) {
      const del = await call("/api/me", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) });
      record(del.res.status === 200, "cleanup: smoke account deleted");
    }
    rmSync(workdir, { recursive: true, force: true });
  }

  console.log(`\nSMOKE RESULT: ${failures === 0 ? "ALL PASSED" : `${failures} FAILED`} (${results.length} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
