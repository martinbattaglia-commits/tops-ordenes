"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

const Schema = z.object({ password: z.string().min(8).max(128) });

export async function updatePassword(
  input: unknown
): Promise<{ ok: boolean; error?: string }> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Contraseña inválida." };

  if (env.app.demoMode) return { ok: true };

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no configurado." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
