import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/providers";
import { verifyState } from "@/lib/auth/oauth-state";
import { encryptNullable } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { platformEnum } from "@/lib/validation";
import { logActivity } from "@/lib/engine/activity";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function fail(reason: string) {
  return NextResponse.redirect(new URL(`/accounts?error=${encodeURIComponent(reason)}`, appUrl()));
}

// Handles the provider's OAuth redirect: verifies state, exchanges the code,
// and persists the connected account with ENCRYPTED tokens.
export async function GET(req: NextRequest, context: { params: Promise<{ platform: string }> }) {
  const { platform: rawPlatform } = await context.params;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return fail(oauthError);
  if (!code || !stateToken) return fail("missing_code");

  let state;
  try {
    state = await verifyState(stateToken);
  } catch {
    return fail("invalid_state");
  }

  const parsed = platformEnum.safeParse(rawPlatform.toUpperCase());
  if (!parsed.success || state.platform !== parsed.data) return fail("platform_mismatch");
  const platform = parsed.data;

  try {
    const provider = getProvider(platform);
    const redirectUri = `${appUrl()}/api/connect/${rawPlatform.toLowerCase()}/callback`;
    const { tokens, account } = await provider.exchangeCode({ code, verifier: state.verifier, redirectUri });

    const saved = await prisma.socialAccount.upsert({
      where: {
        userId_platform_providerAccountId: {
          userId: state.userId,
          platform,
          providerAccountId: account.providerAccountId,
        },
      },
      create: {
        userId: state.userId,
        platform,
        providerAccountId: account.providerAccountId,
        username: account.username,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        accessTokenEnc: encryptNullable(tokens.accessToken),
        refreshTokenEnc: encryptNullable(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        status: account.canPublish ? "CONNECTED" : "LIMITED",
        canPublish: account.canPublish,
        statusDetail: account.statusDetail,
        // Establish a baseline so enabling automations never backfills history.
        baselineAt: new Date(),
        lastCheckedAt: new Date(),
      },
      update: {
        username: account.username,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        accessTokenEnc: encryptNullable(tokens.accessToken),
        refreshTokenEnc: encryptNullable(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        status: account.canPublish ? "CONNECTED" : "LIMITED",
        canPublish: account.canPublish,
        statusDetail: account.statusDetail,
      },
    });

    await logActivity({
      userId: state.userId,
      kind: "account.connected",
      message: `Connected ${platform} account @${account.username ?? account.providerAccountId}`,
      meta: { accountId: saved.id },
    });

    return NextResponse.redirect(new URL(`/accounts?connected=${platform}`, appUrl()));
  } catch (err) {
    logger.error({ err, platform }, "oauth callback failed");
    return fail("connection_failed");
  }
}
