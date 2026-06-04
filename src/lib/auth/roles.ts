import "server-only";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Autorización server-side por rol AUTORITATIVO `profiles.role` (Gate 5.5 hardening).
 *
 * Fuente de verdad = la tabla `profiles` (vía `auth.uid()`), igual que `current_role()`
 * en las RPC. NO usa `user_metadata.role` (que es solo display del shell y puede
 * divergir — fue lo que indujo el falso positivo F-01 en el E2E).
 *
 * En demo mode no gatea (preview con mocks): devuelve 'admin'.
 */

export async function getCurrentProfileRole(): Promise<string | null> {
  if (env.app.demoMode) return "admin";
  const supabase = createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

/** True si el usuario autenticado es admin (según `profiles.role`). */
export async function isCurrentUserAdmin(): Promise<boolean> {
  return (await getCurrentProfileRole()) === "admin";
}
