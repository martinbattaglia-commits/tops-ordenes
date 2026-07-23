// Perfil de Usuario (RC1.4) — modelo. Reusa public.profiles (+ columnas 0154). Sin IA.

export type PresenceStatus = "online" | "idle" | "busy" | "offline";
export type NotifFreq = "instant" | "daily" | "weekly" | "mute";

export interface UserPreferences {
  theme?: "system" | "light" | "dark";
  locale?: string;
  dateFormat?: string;
  signature?: string;
  [k: string]: unknown;
}

export interface UserProfile {
  id: string;
  fullName: string | null;
  email: string | null;
  role: string;
  avatarUrl: string | null;
  initials: string;
  presence: PresenceStatus;
  notifFreq: NotifFreq;
  preferences: UserPreferences;
}

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  online: "Disponible", idle: "Ausente", busy: "Ocupado", offline: "Desconectado",
};
export const NOTIF_FREQ_LABELS: Record<NotifFreq, string> = {
  instant: "Inmediata", daily: "Resumen diario", weekly: "Resumen semanal", mute: "Silenciada",
};

/** Iniciales (1-2) en mayúscula desde el nombre completo (mismo criterio que el Shell). */
export function initialsFrom(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NN";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
