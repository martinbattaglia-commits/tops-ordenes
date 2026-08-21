import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  PASSWORD_INVITE_COOKIE,
  PASSWORD_INVITE_TOKEN_COOKIE,
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_TOKEN_COOKIE,
  safeAuthNext,
} from "@/lib/supabase/auth-recovery";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeAuthNext(searchParams.get("next"));

  if (code) {
    const supabase = createClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        const response = NextResponse.redirect(new URL(next, origin));
        // Magic link / OAuth no debe heredar marcadores de recuperación previos
        const opts = {
          path: "/auth/reset-password",
          maxAge: 0,
          httpOnly: true,
          sameSite: "lax" as const,
          secure: process.env.NODE_ENV === "production",
        };
        response.cookies.set(PASSWORD_RECOVERY_COOKIE, "", opts);
        response.cookies.set(PASSWORD_INVITE_COOKIE, "", opts);
        response.cookies.set(PASSWORD_RECOVERY_TOKEN_COOKIE, "", { ...opts, path: "/auth/recovery" });
        response.cookies.set(PASSWORD_INVITE_TOKEN_COOKIE, "", { ...opts, path: "/auth/invite" });
        return response;
      }
    }
  }

  return NextResponse.redirect(new URL("/login?error=callback_failed", origin));
}
