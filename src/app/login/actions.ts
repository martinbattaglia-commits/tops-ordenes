"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  PASSWORD_INVITE_COOKIE,
  PASSWORD_INVITE_TOKEN_COOKIE,
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_TOKEN_COOKIE,
  safeAuthNext,
  sanitizeAuthErrorMessage,
} from "@/lib/supabase/auth-recovery-shared";

interface SignInInput {
  email: string;
  password: string;
  redirectTo?: string;
}

export async function purgeResidualTransitionCookies() {
  const cookieStore = cookies();
  const opts = {
    path: "/auth/reset-password",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
  cookieStore.set(PASSWORD_RECOVERY_COOKIE, "", opts);
  cookieStore.set(PASSWORD_INVITE_COOKIE, "", opts);
  cookieStore.set(PASSWORD_RECOVERY_TOKEN_COOKIE, "", { ...opts, path: "/auth/recovery" });
  cookieStore.set(PASSWORD_INVITE_TOKEN_COOKIE, "", { ...opts, path: "/auth/invite" });
}

export async function signIn({
  email,
  password,
  redirectTo,
}: SignInInput): Promise<{ ok: boolean; error?: string; redirect?: string }> {
  if (env.app.demoMode) {
    return { ok: true, redirect: safeAuthNext(redirectTo) };
  }
  const supabase = createClient();
  if (!supabase) {
    return { ok: false, error: "Error de conexión con el servidor." };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: sanitizeAuthErrorMessage(error, "Credenciales inválidas. Verificá tu correo y contraseña.") };
  }
  purgeResidualTransitionCookies();
  return { ok: true, redirect: safeAuthNext(redirectTo) };
}

interface MagicInput {
  email: string;
  redirectTo?: string;
}

export async function sendMagicLink({
  email,
  redirectTo,
}: MagicInput): Promise<{ ok: boolean; error?: string }> {
  if (env.app.demoMode) {
    return { ok: true };
  }
  const supabase = createClient();
  if (!supabase) {
    return { ok: false, error: "Error de conexión con el servidor." };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${env.app.url}/api/auth/callback?next=${encodeURIComponent(safeAuthNext(redirectTo))}`,
    },
  });
  if (error) {
    return { ok: false, error: sanitizeAuthErrorMessage(error, "No pudimos enviar el enlace. Reintentá en unos minutos.") };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;
  await supabase.auth.signOut();
  purgeResidualTransitionCookies();
}
