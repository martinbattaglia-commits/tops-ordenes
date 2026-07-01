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
  entity: string | null; entity_id: string | null; read_at: string | null;
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
    supabase
      .from("notifications")
      .select("id, kind, title, message, entity, entity_id, read_at, created_at, priority, remind_at, delegated_to")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("v_connect_inbox")
      .select("conversation_id, title, slug, kind, unread_count, last_message_at")
      .gt("unread_count", 0),
    supabase.auth.getUser(),
  ]);
  const uid = userRes.data.user?.id ?? null;

  const items: NotificationItem[] = [];
  // Anti-fatiga F4.1B (D-F41-2/3): si una conversación ya tiene notificación connect NO leída
  // (mención/DM), se omite su fila derivada de "no leídos" — una sola entrada por conversación.
  const notifiedConvIds = new Set<string>();
  for (const r of (notifs.data ?? []) as NotifRow[]) {
    if (r.remind_at && r.remind_at > nowIso) continue; // snooze: oculto hasta su hora
    if (r.entity === "connect" && r.entity_id && r.read_at == null) {
      notifiedConvIds.add(r.entity_id);
    }
    items.push({
      id: r.id, source: "notification", priority: toPriority(r.priority), kind: r.kind,
      title: r.title, message: r.message, href: hrefFor(r.entity, r.entity_id),
      createdAt: r.created_at, read: r.read_at != null,
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

/** Conteo de no-leídas (para el badge del Centro). */
export async function countUnreadNotifications(): Promise<number> {
  const items = await listNotificationCenter();
  return items.filter((i) => !i.read).length;
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
