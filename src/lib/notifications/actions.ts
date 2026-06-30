"use server";

// Centro de Notificaciones (RC1.4) — acciones sobre la tabla notifications (RLS: filas propias).
// Reusa la columna read_at + remind_at (A4, mig 0147). Sin motor nuevo. Fail-closed (sesión).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type SimpleResult = { ok: true } | { ok: false; message: string };

async function session() {
  const supabase = createClient();
  if (!supabase) return { ok: false as const, message: "Modo demo: no persiste (sin Supabase)." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Sesión no autenticada." };
  return { ok: true as const, supabase };
}

export async function markNotificationReadAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase
    .from("notifications").update({ read_at: new Date().toISOString() }).eq("id", p.data.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/connect/notificaciones");
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<SimpleResult> {
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase
    .from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/connect/notificaciones");
  return { ok: true };
}

export async function snoozeNotificationAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ id: z.string().uuid(), until: z.string().datetime() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase
    .from("notifications").update({ remind_at: p.data.until }).eq("id", p.data.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/connect/notificaciones");
  return { ok: true };
}
