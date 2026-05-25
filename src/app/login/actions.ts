"use server";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

interface SignInInput {
  email: string;
  password: string;
  redirectTo?: string;
}

export async function signIn({
  email,
  password,
  redirectTo,
}: SignInInput): Promise<{ ok: boolean; error?: string; redirect?: string }> {
  if (env.app.demoMode) {
    // En demo dejamos pasar sin validar — sólo evaluación de UI.
    return { ok: true, redirect: redirectTo ?? "/dashboard" };
  }
  const supabase = createClient();
  if (!supabase) {
    return { ok: false, error: "Supabase no está configurado en el servidor." };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, redirect: redirectTo ?? "/dashboard" };
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
    return { ok: false, error: "Supabase no está configurado en el servidor." };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${env.app.url}/api/auth/callback?next=${redirectTo ?? "/dashboard"}`,
    },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;
  await supabase.auth.signOut();
}
