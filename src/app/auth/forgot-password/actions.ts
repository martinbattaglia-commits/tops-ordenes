"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { clientKey, rateLimit } from "@/lib/rate-limit";

const Schema = z.object({ email: z.string().email() });

export async function sendPasswordResetLink(
  input: unknown
): Promise<{ ok: boolean; error?: string }> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Email inválido." };

  const h = headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  const rl = rateLimit(`pwreset:${clientKey(ip)}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!rl.ok) {
    return {
      ok: false,
      error: `Demasiados intentos. Reintentá en ${Math.ceil(rl.retryAfterMs / 60000)} min.`,
    };
  }

  if (env.app.demoMode) return { ok: true };

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no configurado." };

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.app.url}/auth/reset-password`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
