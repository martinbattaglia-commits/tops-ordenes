"use server";

// Perfil de Usuario (RC1.4) — acciones. Escritura por RPC SECDEF (0154) sobre el perfil propio
// (auth.uid()), fail-closed. Presencia persistente (D-RC1.4-3, sin Presence realtime).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type SimpleResult = { ok: true } | { ok: false; message: string };

async function session() {
  const supabase = createClient();
  if (!supabase) return { ok: false as const, message: "Modo demo: el perfil no persiste (sin Supabase)." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Sesión no autenticada." };
  return { ok: true as const, supabase };
}

export async function setPresenceAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ status: z.enum(["online", "idle", "busy", "offline"]) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Estado inválido." };
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase.rpc("set_my_presence", { p_status: p.data.status });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/connect", "layout");
  return { ok: true };
}

export async function updateMyProfileAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({
    avatarUrl: z.string().url().nullable().optional(),
    notifFreq: z.enum(["instant", "daily", "weekly", "mute"]).nullable().optional(),
    preferences: z.record(z.unknown()).nullable().optional(),
  }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase.rpc("update_my_profile", {
    p_avatar_url: p.data.avatarUrl ?? null,
    p_notif_freq: p.data.notifFreq ?? null,
    p_meta: p.data.preferences ?? null,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/connect", "layout");
  revalidatePath("/settings/perfil");
  return { ok: true };
}
