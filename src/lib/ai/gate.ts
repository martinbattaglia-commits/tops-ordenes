// F5.2-lite · Gate del Copilot (decisión Dirección 2026-07-03):
//   1. AI_ENABLED — kill-switch global FAIL-CLOSED.
//   2. Sesión autenticada.
//   3. Allowlist explícita ai_pilot_users (estar acá NO amplía permisos de
//      datos: eso lo decide la RLS de cada fuente).
// En demo mode (isMock) el gate pasa: no hay DB ni datos reales.

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type GateStatus =
  | { ok: true; userId: string; demo: boolean }
  | { ok: false; outcome: "killed" | "denied"; message: string };

export function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

export const KILLED_MESSAGE =
  "El Copilot está desactivado en este entorno (AI_ENABLED).";
export const DENIED_MESSAGE =
  "El Copilot está en piloto cerrado. Pedile acceso a Dirección si lo necesitás.";

export async function checkGate(): Promise<GateStatus> {
  if (!env.ai.enabled) {
    return { ok: false, outcome: "killed", message: KILLED_MESSAGE };
  }
  if (isMock()) {
    return { ok: true, userId: "demo-user", demo: true };
  }
  const supabase = createClient();
  if (!supabase) {
    return { ok: false, outcome: "killed", message: KILLED_MESSAGE };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, outcome: "denied", message: DENIED_MESSAGE };
  }
  const { data, error } = await supabase
    .from("ai_pilot_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) {
    // Fail-closed: error de lectura del gate = no piloto.
    return { ok: false, outcome: "denied", message: DENIED_MESSAGE };
  }
  return { ok: true, userId: user.id, demo: false };
}
