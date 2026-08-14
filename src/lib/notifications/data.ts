import "server-only";

// Centro de Notificaciones (RC1.4) — LECTURA. Modelo HÍBRIDO: AGREGA lo existente (D-RC1.4-5),
// sin motor nuevo: (a) tabla notifications (con priority/remind_at A4); (b) conversaciones no leídas
// (v_connect_inbox) como avisos derivados de "mensajes nuevos". Snooze = oculta remind_at futuro.
// isMock()→seeds. Lectura por sesión (RLS). Realtime/polling lo maneja la UI.

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { hrefFor } from "./href";
import { type NotificationItem, toPriority, byPriorityThenRecency } from "./types";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

interface NotifRow {
  id: string; kind: string; title: string; message: string | null;
  entity: string | null; entity_id: string | null; is_read: boolean;
  created_at: string; priority: string | null; remind_at: string | null;
  delegated_to: string | null;
}
interface InboxUnreadRow {
  conversation_id: string; title: string | null; slug: string | null;
  kind: string; unread_count: number; last_message_at: string | null;
}

export async function listNotificationCenter(): Promise<NotificationItem[]> {
  if (isMock()) return mockNotificationCenter();
  const supabase = createClient();
  if (!supabase) return mockNotificationCenter();

  const nowIso = new Date().toISOString();
  const [notifs, inbox, userRes] = await Promise.all([
    // Semántica ÚNICA (0235): `v_link_my_notifications` resuelve el aislamiento
    // por destinatario dentro de la vista y expone `is_read` ya combinando el
    // `read_at` de los avisos directos con la lectura PERSONAL de los
    // broadcasts. Antes esta consulta iba contra `notifications` sin filtro y
    // delegaba en la RLS: a un perfil admin le entregaba, en su bandeja
    // personal, las notificaciones de toda la organización.
    supabase
      .from("v_link_my_notifications")
      .select("id, kind, title, message, entity, entity_id, is_read, created_at, priority, remind_at, delegated_to")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("v_connect_inbox")
      .select("conversation_id, title, slug, kind, unread_count, last_message_at")
      .gt("unread_count", 0)
      // R-2 (F4.1D): una conversación archivada con no-leídos NO cuenta como aviso
      // (la vista expone archived_at desde 0145).
      .is("archived_at", null),
    supabase.auth.getUser(),
  ]);
  const uid = userRes.data.user?.id ?? null;

  // Anti-fatiga F4.1B (D-F41-2): set COMPLETO de conversaciones con notificación connect NO leída
  // (query dedicada, no la página de 50 — hallazgo de revisión; incluye snoozeadas: una notif
  // pospuesta sigue suprimiendo la fila derivada de "no leídos" de su conversación).
  // Misma semántica única: se pregunta por MIS avisos connect sin leer, no por
  // los de cualquiera (con la RLS de auditoría, un admin suprimía filas de
  // conversación por notificaciones ajenas).
  const notifiedConvIds = new Set<string>();
  const { data: unreadConnect } = await supabase
    .from("v_link_my_notifications")
    .select("entity_id")
    .eq("entity", "connect")
    .eq("is_read", false)
    .limit(500);
  for (const r of (unreadConnect ?? []) as Array<{ entity_id: string | null }>) {
    if (r.entity_id) notifiedConvIds.add(r.entity_id);
  }

  const items: NotificationItem[] = [];
  for (const r of (notifs.data ?? []) as NotifRow[]) {
    if (r.remind_at && r.remind_at > nowIso) continue; // snooze: oculto hasta su hora
    items.push({
      id: r.id, source: "notification", priority: toPriority(r.priority), kind: r.kind,
      title: r.title, message: r.message, href: hrefFor(r.entity, r.entity_id),
      createdAt: r.created_at, read: r.is_read,
      isDelegated: r.delegated_to != null,
      delegatedToMe: uid != null && r.delegated_to === uid,
    });
  }
  for (const c of (inbox.data ?? []) as InboxUnreadRow[]) {
    if (notifiedConvIds.has(c.conversation_id)) continue;
    items.push({
      id: `conv:${c.conversation_id}`, source: "conversation", priority: "normal", kind: "message",
      title: c.title ?? c.slug ?? "Conversación",
      message: `${c.unread_count} mensaje${c.unread_count === 1 ? "" : "s"} sin leer`,
      href: `/connect/c/${c.conversation_id}`, createdAt: c.last_message_at ?? nowIso, read: false,
    });
  }
  return items.sort(byPriorityThenRecency);
}

/**
 * Los tres contadores de la campanita, leídos de `v_link_notification_badges`
 * (0234) — la MISMA fuente de verdad que usa la shell y que los badges por
 * conversación.
 *
 * C4 2/2 · M-1: la tarjeta "Notificaciones" del home derivaba su cifra de
 * `listNotificationCenter()`, que no filtra destinatario (delega en la RLS,
 * cuya rama `current_role()='admin'` devuelve los avisos de TODA la
 * organización) y además está topeada por su `limit(50)`. Rotulada como
 * categoría roja, mostraba pendientes ajenos como propios y divergía de la
 * campanita en la misma pantalla. El badge sale de acá.
 *
 * Fail-safe: si 0234 todavía no está aplicada devuelve ceros, sin romper.
 */
export async function readNotificationBadges(): Promise<{
  red: number; green: number; yellow: number;
}> {
  const vacio = { red: 0, green: 0, yellow: 0 };
  if (isMock()) return vacio;
  const supabase = createClient();
  if (!supabase) return vacio;
  const { data, error } = await supabase
    .from("v_link_notification_badges")
    .select("red_system_count, green_whatsapp_count, yellow_internal_count")
    .maybeSingle();
  if (error || !data) return vacio;
  return {
    red: Number(data.red_system_count ?? 0),
    green: Number(data.green_whatsapp_count ?? 0),
    yellow: Number(data.yellow_internal_count ?? 0),
  };
}

// ── Demo seeds ──
function mockNotificationCenter(): NotificationItem[] {
  const now = Date.parse("2026-06-30T12:00:00.000Z");
  const T = (m: number) => new Date(now - m * 60_000).toISOString();
  const items: NotificationItem[] = [
    { id: "n1", source: "notification", priority: "urgente", kind: "incident", title: "Avería montacargas D4", message: "Montacargas #3 fuera de servicio", href: "/connect/c/c-inc-1", createdAt: T(20), read: false },
    { id: "n2", source: "notification", priority: "importante", kind: "order", title: "OS-2026-0142 firmada", message: "Lista para coordinar entrega", href: "/connect/e/orders/00000000-0000-4000-8000-0000000000aa", createdAt: T(120), read: false },
    { id: "conv:c-dm-1", source: "conversation", priority: "normal", kind: "message", title: "María González", message: "1 mensaje sin leer", href: "/connect/c/c-dm-1", createdAt: T(6), read: false },
    { id: "n3", source: "notification", priority: "normal", kind: "system", title: "Bienvenido a Nexus Link", message: "Tu plataforma colaborativa", href: "/connect", createdAt: T(600), read: true },
  ];
  return items.sort(byPriorityThenRecency);
}
