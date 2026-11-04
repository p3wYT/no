import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getProvider } from "@/lib/providers";
import { generatePkce, signState } from "@/lib/auth/oauth-state";
import { appUrl } from "@/lib/env";
import { platformEnum } from "@/lib/validation";

export const dynamic = "force-dynamic";

// Starts the official provider OAuth flow (state + PKCE), then redirects the
// user to the provider's authorization page.
export async function GET(req: NextRequest, context: { params: Promise<{ platform: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", appUrl()));

  const { platform: rawPlatform } = await context.params;
  const parsed = platformEnum.safeParse(rawPlatform.toUpperCase());
  if (!parsed.success) return NextResponse.redirect(new URL("/accounts?error=unknown_platform", appUrl()));
  const platform = parsed.data;

  const provider = getProvider(platform);
  if (!provider.isConfigured()) {
    return NextResponse.redirect(new URL(`/accounts?error=not_configured&platform=${platform}`, appUrl()));
  }

  const { verifier, challenge } = generatePkce();
  const state = await signState({ userId: user.id, platform, verifier });
  const redirectUri = `${appUrl()}/api/connect/${rawPlatform.toLowerCase()}/callback`;

  const authUrl = provider.getAuthUrl({ state, challenge, redirectUri });
  return NextResponse.redirect(authUrl);
}
