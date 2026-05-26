"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { clientKey, rateLimit } from "@/lib/rate-limit";

const Schema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2).max(120),
  role: z.enum(["admin", "operaciones", "supervisor", "cliente"]),
});

export async function inviteUser(
  input: unknown
): Promise<{ ok: boolean; error?: string }> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  if (env.app.demoMode) {
    return { ok: false, error: "Demo mode: la gestión de usuarios requiere Supabase real." };
  }

  const h = headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  const rl = rateLimit(`invite:${clientKey(ip)}`, { limit: 20, windowMs: 60 * 60 * 1000 });
  if (!rl.ok) return { ok: false, error: "Demasiadas invitaciones en una hora." };

  // Verificar que el caller sea admin
  const supabase = createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) return { ok: false, error: "Supabase no configurado." };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado." };

  const { data: meProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (meProfile?.role !== "admin") {
    return { ok: false, error: "Solo los administradores pueden invitar usuarios." };
  }

  // Invitar vía email
  const { data: invited, error: invErr } =
    await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
      data: {
        full_name: parsed.data.full_name,
        role: parsed.data.role,
        invited_by: user.email,
      },
      redirectTo: `${env.app.url}/auth/reset-password`,
    });
  if (invErr) return { ok: false, error: invErr.message };

  // Set role en profile (el trigger handle_new_user lo crea con 'operaciones' por default)
  if (invited.user) {
    await admin
      .from("profiles")
      .upsert({
        id: invited.user.id,
        email: parsed.data.email,
        full_name: parsed.data.full_name,
        role: parsed.data.role,
      });
  }

  await admin.from("audit_log").insert({
    user_id: user.id,
    entity: "profiles",
    entity_id: invited.user?.id ?? null,
    action: "invite",
    payload: { email: parsed.data.email, role: parsed.data.role },
    ip,
  });

  revalidatePath("/settings/users");
  return { ok: true };
}
