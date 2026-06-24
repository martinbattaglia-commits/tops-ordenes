import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AnnouncementRow } from "./types";

/** Fallback para demo/preview (sin Supabase): espeja el seed de la migración 0084. */
const MOCK: AnnouncementRow[] = [
  { id: "seed-1", title: "¡Atención!", description: "Actualización urgente del sistema", icon: "megaphone", priority: "critical", active: true, sort_order: 0, created_at: "", updated_at: "" },
  { id: "seed-2", title: "Sábado 28/06", description: "22:00 a 02:00 hs", icon: "calendar", priority: "high", active: true, sort_order: 1, created_at: "", updated_at: "" },
  { id: "seed-3", title: "Política de seguridad", description: "Cambios de contraseña cada 60 días", icon: "shield", priority: "medium", active: true, sort_order: 2, created_at: "", updated_at: "" },
  { id: "seed-4", title: "Reunión general", description: "Viernes 27/06 · 09:00 hs", icon: "users", priority: "medium", active: true, sort_order: 3, created_at: "", updated_at: "" },
];

/** Lista para la pantalla de admin (incluye inactivos por defecto cuando se pide). */
export async function listAnnouncements(opts: { includeInactive?: boolean } = {}): Promise<AnnouncementRow[]> {
  const supabase = createClient();
  if (!supabase) return MOCK;
  let q = supabase.from("announcements").select("*").order("sort_order").order("created_at");
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(`listAnnouncements: ${error.message}`);
  return (data ?? []) as AnnouncementRow[];
}
