"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_TOKEN_COOKIE,
  PASSWORD_INVITE_COOKIE,
  createAuthTransitionToken,
  extractSessionId,
  recoveryCookieOptions,
  recoveryTokenCookieOptions,
  inviteCookieOptions,
  otpErrorKind,
} from "@/lib/supabase/auth-recovery";

export async function confirmPasswordRecovery(): Promise<{ ok: boolean; error?: "invalid" | "expired" | "network" }> {
  const cookieStore = cookies();
  const tokenHash = cookieStore.get(PASSWORD_RECOVERY_TOKEN_COOKIE)?.value;
  if (!tokenHash) {
    return { ok: false, error: "invalid" };
  }

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "network" };

  let authUser;
  let sessionId: string | null = null;
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      type: "recovery",
      token_hash: tokenHash,
    });
    if (error || !data?.user) {
      return { ok: false, error: otpErrorKind(error?.message) };
    }
    authUser = data.user;
    sessionId = extractSessionId(data.session);
    if (!sessionId) {
      const { data: sessionData } = await supabase.auth.getSession();
      sessionId = extractSessionId(sessionData?.session);
    }
  } catch {
    return { ok: false, error: "network" };
  }

  if (!sessionId) {
    return { ok: false, error: "invalid" };
  }

  const transitionToken = await createAuthTransitionToken({
    purpose: "recovery",
    userId: authUser.id,
    sessionId,
    userEmail: authUser.email ?? "",
  });

  cookieStore.set(PASSWORD_RECOVERY_COOKIE, transitionToken, recoveryCookieOptions());
  cookieStore.set(PASSWORD_RECOVERY_TOKEN_COOKIE, "", {
    ...recoveryTokenCookieOptions(),
    maxAge: 0,
  });
  cookieStore.set(PASSWORD_INVITE_COOKIE, "", {
    ...inviteCookieOptions(),
    maxAge: 0,
  });

  return { ok: true };
}
