/**
 * Comunicaciones corporativas del Command Center (Cockpit Ejecutivo).
 *
 * HOY: lista curada en código (sin dependencia de datos externa).
 * FUTURO: reemplazar el cuerpo de `getAnnouncements()` por una query a Supabase
 * (tabla `announcements`, filtrada por vigencia/prioridad). La firma asíncrona
 * `Promise<Announcement[]>` ya queda lista para ese cambio sin tocar la UI.
 */
import type { IconName } from "@/components/Icon";

export type AnnouncementPriority = "low" | "medium" | "high" | "critical";

export interface Announcement {
  id: string;
  title: string;
  description: string;
  /** Nombre de ícono del sistema (ver `IconName`). */
  icon: IconName;
  /** ISO 8601. Opcional: ventana de vigencia para futuras reglas de display. */
  startDate?: string;
  endDate?: string;
  priority: AnnouncementPriority;
}

/**
 * Devuelve las comunicaciones activas, ordenadas con la crítica al frente
 * (la UI del banner destaca el primer elemento como bloque principal).
 */
export async function getAnnouncements(): Promise<Announcement[]> {
  const order: Record<AnnouncementPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...SEED_ANNOUNCEMENTS].sort((a, b) => order[a.priority] - order[b.priority]);
}

const SEED_ANNOUNCEMENTS: Announcement[] = [
  {
    id: "sys-update",
    priority: "critical",
    icon: "megaphone",
    title: "¡Atención!",
    description: "Actualización urgente del sistema",
  },
  {
    id: "maintenance-window",
    priority: "high",
    icon: "calendar",
    title: "Sábado 28/06",
    description: "22:00 a 02:00 hs",
    startDate: "2026-06-28T22:00:00-03:00",
    endDate: "2026-06-29T02:00:00-03:00",
  },
  {
    id: "security-policy",
    priority: "medium",
    icon: "shield",
    title: "Política de seguridad",
    description: "Cambios de contraseña cada 60 días",
  },
  {
    id: "general-meeting",
    priority: "medium",
    icon: "users",
    title: "Reunión general",
    description: "Viernes 27/06 · 09:00 hs",
    startDate: "2026-06-27T09:00:00-03:00",
  },
];
