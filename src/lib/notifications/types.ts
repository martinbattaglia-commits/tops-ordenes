// Centro de Notificaciones (RC1.4) — modelo unificado. Prioridad visual D-RC1.4-5.

export type NotificationPriority = "urgente" | "importante" | "normal";

/** Item unificado de la bandeja: notificación persistida o conversación no leída (derivada). */
export interface NotificationItem {
  id: string;
  source: "notification" | "conversation";
  priority: NotificationPriority;
  kind: string;
  title: string;
  message: string | null;
  href: string;
  createdAt: string;
  read: boolean;
  /** F4.1C: la notificación fue delegada (delegated_to != null). */
  isDelegated?: boolean;
  /** F4.1C: fue delegada A MÍ (delegated_to = usuario actual). */
  delegatedToMe?: boolean;
}

/** Mapea la prioridad de la tabla (low/normal/high/urgent) al bucket visual. */
export function toPriority(raw: string | null | undefined): NotificationPriority {
  if (raw === "urgent") return "urgente";
  if (raw === "high") return "importante";
  return "normal";
}

const ORDER: Record<NotificationPriority, number> = { urgente: 0, importante: 1, normal: 2 };

/** Orden: prioridad (urgente→normal) y, dentro, más reciente primero. */
export function byPriorityThenRecency(a: NotificationItem, b: NotificationItem): number {
  return ORDER[a.priority] - ORDER[b.priority] || b.createdAt.localeCompare(a.createdAt);
}
