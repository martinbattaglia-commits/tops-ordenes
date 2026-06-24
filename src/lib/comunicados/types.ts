import type { IconName } from "@/components/Icon";

/** Íconos permitidos para un comunicado (subconjunto de IconName). */
export const COMUNICADO_ICONS = ["megaphone", "calendar", "shield", "users", "bell", "bolt", "sparkle"] as const;
export type ComunicadoIcon = (typeof COMUNICADO_ICONS)[number];

/** Prioridades. `critical` = el bloque amarillo destacado del banner. */
export const COMUNICADO_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type ComunicadoPriority = (typeof COMUNICADO_PRIORITIES)[number];

export const PRIORITY_LABEL: Record<ComunicadoPriority, string> = {
  critical: "Crítica (destacado)",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

/** Fila de la tabla public.announcements (snake_case, como llega de PostgREST). */
export interface AnnouncementRow {
  id: string;
  title: string;
  description: string;
  icon: ComunicadoIcon;
  priority: ComunicadoPriority;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Garantía en compilación de que cada ComunicadoIcon es un IconName válido.
const _iconCheck: Record<ComunicadoIcon, IconName> = {
  megaphone: "megaphone",
  calendar: "calendar",
  shield: "shield",
  users: "users",
  bell: "bell",
  bolt: "bolt",
  sparkle: "sparkle",
};
void _iconCheck;
