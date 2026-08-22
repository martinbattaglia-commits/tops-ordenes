"use server";

// Perfil de Usuario (RC1.4 / P2) — acciones. Escritura por RPC SECDEF (0154) y actualización
// directa RLS de perfil propio (auth.uid()), fail-closed. Presencia persistente (D-RC1.4-3).
// Sanity check y políticas estrictas de almacenamiento de avatar (URL HTTPS o path de storage).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type SimpleResult = { ok: true } | { ok: false; message: string };

async function session() {
  const supabase = createClient();
  if (!supabase) return { ok: false as const, message: "Modo demo: el perfil no persiste (sin Supabase)." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Sesión no autenticada." };
  return { ok: true as const, supabase, user };
}

export async function setPresenceAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ status: z.enum(["online", "idle", "busy", "offline"]) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Estado inválido." };
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase.rpc("set_my_presence", { p_status: p.data.status });
  if (error) return { ok: false, message: "No se pudo actualizar el estado de presencia." };
  revalidatePath("/connect", "layout");
  return { ok: true };
}

const MAX_AVATAR_URL_LEN = 2048; // Max standard URL length

/** Validador seguro de URL de Avatar: sólo HTTPS seguro o paths relativos de storage. */
const AvatarUrlSchema = z
  .string()
  .max(MAX_AVATAR_URL_LEN)
  .refine(
    (url) => url.startsWith("https://") || url.startsWith("/") || url.startsWith("avatars/"),
    { message: "La URL del avatar debe ser HTTPS segura o un path de almacenamiento válido." },
  );

export async function updateMyProfileAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({
    avatarUrl: AvatarUrlSchema.nullable().optional(),
    notifFreq: z.enum(["instant", "daily", "weekly", "mute"]).nullable().optional(),
    preferences: z.record(z.unknown()).nullable().optional(),
  }).safeParse(raw);
  if (!p.success) {
    const issue = p.error.issues[0]?.message || "Datos inválidos.";
    return { ok: false, message: issue };
  }
  const s = await session();
  if (!s.ok) return s;

  // Actualización en profiles (RLS autoriza a auth.uid())
  const updates: Record<string, unknown> = {};
  if (p.data.avatarUrl !== undefined) {
    updates.avatar_url = p.data.avatarUrl;
  }
  if (p.data.notifFreq !== undefined && p.data.notifFreq !== null) {
    updates.notif_freq_default = p.data.notifFreq;
  }
  if (p.data.preferences !== undefined && p.data.preferences !== null) {
    updates.profile_meta = p.data.preferences;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await s.supabase
      .from("profiles")
      .update(updates)
      .eq("id", s.user.id);

    if (updateError) {
      // Fallback a RPC si la tabla no permite update directo
      const { error: rpcError } = await s.supabase.rpc("update_my_profile", {
        p_avatar_url: p.data.avatarUrl ?? null,
        p_notif_freq: p.data.notifFreq ?? null,
        p_meta: p.data.preferences ?? null,
      });
      if (rpcError) {
        return { ok: false, message: "No se pudo actualizar el perfil. Probá de nuevo." };
      }
    }
  }

  revalidatePath("/connect", "layout");
  revalidatePath("/settings/perfil");
  return { ok: true };
}

export async function removeAvatarAction(): Promise<SimpleResult> {
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", s.user.id);
  if (error) {
    return { ok: false, message: "No se pudo quitar la foto de perfil. Probá de nuevo." };
  }
  revalidatePath("/connect", "layout");
  revalidatePath("/settings/perfil");
  return { ok: true };
}
