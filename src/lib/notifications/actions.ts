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

// FASE A · 0235: el marcado de lectura pasa a RPC SECDEF, una sola vía de
// escritura con verificación explícita del destinatario.
//
// El UPDATE directo anterior tenía dos defectos materiales:
//  · `.eq("id", …)` se apoyaba en la policy de UPDATE, cuya rama
//    `current_role() = 'admin'` deja a un admin marcar leída la notificación
//    de CUALQUIER usuario;
//  · `markAll` hacía `.is("read_at", null)` SIN filtro de destinatario: para un
//    perfil admin marcaba leídas las pendientes de toda la organización de un
//    solo clic, silenciosamente.
// Además, un broadcast por rol es una fila compartida: marcarla por UPDATE la
// apagaba para todo el rol. La RPC registra la lectura PERSONAL en
// `notification_reads` y no toca a terceros.
export async function markNotificationReadAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase.rpc("connect_notif_mark_read", { p_id: p.data.id });
  if (error) return { ok: false, message: mapNotifRpcError(error.message) };
  revalidatePath("/connect/notificaciones");
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<SimpleResult> {
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase.rpc("connect_notif_mark_all_read");
  if (error) return { ok: false, message: mapNotifRpcError(error.message) };
  revalidatePath("/connect/notificaciones");
  return { ok: true };
}

/** Traduce errores Postgres de las RPCs 0162 a mensajes accionables (lección DEFECT-4). */
function mapNotifRpcError(message: string): string {
  if (/inexistente/.test(message)) return "La notificación ya no existe.";
  if (/no está dirigida a este usuario/.test(message)) {
    return "Esa notificación no está dirigida a vos.";
  }
  if (/sesión no autenticada/.test(message)) return "Sesión no autenticada.";
  if (/dueño o el delegado|insufficient_privilege/i.test(message)) {
    return "Solo el dueño o el delegado pueden accionar esta notificación.";
  }
  if (/snooze inválido/.test(message)) return "El recordatorio debe ser entre 1 minuto y 30 días.";
  if (/destinatario no es un usuario interno/.test(message)) {
    return "Elegí un usuario interno válido para delegar.";
  }
  if (/prioridad inválida/.test(message)) return "Prioridad inválida.";
  return message;
}

// F4.1C: snooze pasa de update directo a RPC SECDEF (connect_notif_snooze, 0162) — una sola vía
// de escritura con validación de ventana (1 min..30 días) y soporte de actor DELEGADO.
export async function snoozeNotificationAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ id: z.string().uuid(), until: z.string().datetime() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase.rpc("connect_notif_snooze", {
    p_id: p.data.id,
    p_remind_at: p.data.until,
  });
  if (error) return { ok: false, message: mapNotifRpcError(error.message) };
  revalidatePath("/connect/notificaciones");
  return { ok: true };
}

/** F4.1C (D-F41-7): delega una notificación a otro usuario interno. Audita en audit_log (RPC 0162). */
export async function delegateNotificationAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ id: z.string().uuid(), toProfileId: z.string().uuid() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase.rpc("connect_notif_delegate", {
    p_id: p.data.id,
    p_to_profile: p.data.toProfileId,
  });
  if (error) return { ok: false, message: mapNotifRpcError(error.message) };
  revalidatePath("/connect/notificaciones");
  return { ok: true };
}

/** F4.1C (D-F41-7): cambia la prioridad de una notificación propia/delegada (RPC 0162). */
export async function setNotificationPriorityAction(raw: unknown): Promise<SimpleResult> {
  const p = z
    .object({ id: z.string().uuid(), priority: z.enum(["low", "normal", "high", "urgent"]) })
    .safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const s = await session();
  if (!s.ok) return s;
  const { error } = await s.supabase.rpc("connect_notif_set_priority", {
    p_id: p.data.id,
    p_priority: p.data.priority,
  });
  if (error) return { ok: false, message: mapNotifRpcError(error.message) };
  revalidatePath("/connect/notificaciones");
  return { ok: true };
}
