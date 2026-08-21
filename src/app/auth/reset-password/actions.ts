"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_INVITE_COOKIE,
  PASSWORD_RECOVERY_TOKEN_COOKIE,
  PASSWORD_INVITE_TOKEN_COOKIE,
  validateNewPassword,
  verifyAuthTransitionToken,
  extractSessionId,
  sanitizeAuthErrorMessage,
} from "@/lib/supabase/auth-recovery";

interface PasswordResetInput {
  password: string;
  confirmation: string;
}

export async function completePasswordReset(
  input: PasswordResetInput,
): Promise<{ ok: boolean; error?: string; passwordUpdated?: boolean }> {
  const validationError = validateNewPassword(input.password, input.confirmation);
  if (validationError) return { ok: false, error: validationError };

  const cookieStore = cookies();
  const recoveryRaw = cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value;
  const inviteRaw = cookieStore.get(PASSWORD_INVITE_COOKIE)?.value;

  const purgeCookies = () => {
    const opts = {
      path: "/auth/reset-password",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
    };
    cookieStore.set({ name: PASSWORD_RECOVERY_COOKIE, value: "", ...opts });
    cookieStore.set({ name: PASSWORD_INVITE_COOKIE, value: "", ...opts });
    cookieStore.set({ name: PASSWORD_RECOVERY_TOKEN_COOKIE, value: "", ...opts, path: "/auth/recovery" });
    cookieStore.set({ name: PASSWORD_INVITE_TOKEN_COOKIE, value: "", ...opts, path: "/auth/invite" });
  };

  const supabase = createClient();
  if (!supabase) {
    return { ok: false, error: "Error de conexión. Volvé a intentarlo en unos momentos." };
  }

  let user;
  let sessionId: string | null = null;
  try {
    const userRes = await supabase.auth.getUser();
    user = userRes.data?.user;
    const sessionRes = await supabase.auth.getSession();
    sessionId = extractSessionId(sessionRes.data?.session);

    if (userRes.error || !user || !sessionId) {
      purgeCookies();
      return { ok: false, error: "La sesión de recuperación venció. Pedí un enlace nuevo." };
    }
  } catch {
    return { ok: false, error: "No pudimos validar la sesión por un error de red. Volvé a intentarlo." };
  }

  const currentAuth = { userId: user.id, sessionId, email: user.email };
  const recoveryRes = recoveryRaw
    ? await verifyAuthTransitionToken(recoveryRaw, "recovery", currentAuth)
    : { valid: false };
  const inviteRes = inviteRaw
    ? await verifyAuthTransitionToken(inviteRaw, "invite", currentAuth)
    : { valid: false };

  if (recoveryRes.valid === inviteRes.valid) {
    purgeCookies();
    return { ok: false, error: "La sesión para definir la contraseña no es válida o expiró. Pedí un enlace nuevo." };
  }

  let error;
  try {
    ({ error } = await supabase.auth.updateUser({ password: input.password }));
  } catch (err) {
    return { ok: false, error: sanitizeAuthErrorMessage(err, "No pudimos guardar la contraseña por un error de red.") };
  }

  if (error) {
    return {
      ok: false,
      error: sanitizeAuthErrorMessage(error, "No pudimos guardar la contraseña. Volvé a intentarlo."),
    };
  }

  // Cierre estricto de sesión local tras definir la contraseña
  let signOutError;
  try {
    ({ error: signOutError } = await supabase.auth.signOut({ scope: "local" }));
  } catch {
    signOutError = new Error("network");
  }

  purgeCookies();

  if (signOutError) {
    return {
      ok: false,
      passwordUpdated: true,
      error: "La contraseña fue actualizada. Cerrá esta ventana e ingresá normalmente con tu nueva contraseña.",
    };
  }

  return { ok: true };
}
