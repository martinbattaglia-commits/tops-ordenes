/**
 * Comunicaciones corporativas del Command Center (Cockpit Ejecutivo).
 *
 * Fuente: tabla `public.announcements` (editable desde Sistema › Comunicados).
 * El tipo `Announcement` expuesto a la UI no cambia: `CommandCenterBanner`
 * destaca el primer elemento (mayor prioridad) como bloque principal.
 *
 * Fallbacks (el cockpit nunca se rompe):
 *  - sin Supabase (demo/preview) → SEED_ANNOUNCEMENTS,
 *  - error de DB → [] (banner oculto),
 *  - 0 activos → [] → el banner no se renderiza.
 */
import { createClient } from "@/lib/supabase/server";
import type { IconName } from "@/components/Icon";

export type AnnouncementPriority = "low" | "medium" | "high" | "critical";

export interface Announcement {
  id: string;
  title: string;
  description: string;
  /** Nombre de ícono del sistema (ver `IconName`). */
  icon: IconName;
  priority: AnnouncementPriority;
}

const PRIORITY_RANK: Record<AnnouncementPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const byPriority = (a: Announcement, b: Announcement) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

/**
 * Devuelve las comunicaciones activas, con la de mayor prioridad al frente.
 * El orden secundario (sort_order) se respeta porque Array.sort es estable.
 */
export async function getAnnouncements(): Promise<Announcement[]> {
  const supabase = createClient();
  if (!supabase) return [...SEED_ANNOUNCEMENTS].sort(byPriority); // demo / preview
  const { data, error } = await supabase
    .from("announcements")
    .select("id,title,description,icon,priority,sort_order")
    .eq("active", true)
    .order("sort_order")
    .order("created_at");
  if (error) return [];
  return (data ?? [])
    .map((r): Announcement => ({
      id: r.id as string,
      title: r.title as string,
      description: (r.description as string) ?? "",
      icon: r.icon as IconName,
      priority: r.priority as AnnouncementPriority,
    }))
    .sort(byPriority);
}

/** Fallback de demo/preview: espeja el seed de la migración 0084. */
const SEED_ANNOUNCEMENTS: Announcement[] = [
  { id: "sys-update", priority: "critical", icon: "megaphone", title: "¡Atención!", description: "Actualización urgente del sistema" },
  { id: "maintenance-window", priority: "high", icon: "calendar", title: "Sábado 28/06", description: "22:00 a 02:00 hs" },
  { id: "security-policy", priority: "medium", icon: "shield", title: "Política de seguridad", description: "Cambios de contraseña cada 60 días" },
  { id: "general-meeting", priority: "medium", icon: "users", title: "Reunión general", description: "Viernes 27/06 · 09:00 hs" },
];
