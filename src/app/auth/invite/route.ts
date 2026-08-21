import { NextResponse, type NextRequest } from "next/server";
import {
  PASSWORD_INVITE_TOKEN_COOKIE,
  inviteTokenCookieOptions,
  safeOtpTokenHash,
} from "@/lib/supabase/auth-recovery";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = safeOtpTokenHash(url.searchParams.get("token_hash"));
  const type = url.searchParams.get("type");
  const destination = new URL("/auth/invite/confirm", url.origin);

  if (!tokenHash || type !== "invite") {
    destination.searchParams.set("error", "invalid");
    return NextResponse.redirect(destination, {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }

  const response = NextResponse.redirect(destination, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
  response.cookies.set(PASSWORD_INVITE_TOKEN_COOKIE, tokenHash, inviteTokenCookieOptions());
  return response;
}
