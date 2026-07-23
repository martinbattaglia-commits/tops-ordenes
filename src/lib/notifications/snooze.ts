// F4.1C — Snooze del Centro de Notificaciones: presets y validación (PURO, testeable).
// Espejo del guard de connect_notif_snooze (0162): ventana 1 minuto .. 30 días desde ahora.

export const SNOOZE_MIN_MS = 60_000;
export const SNOOZE_MAX_MS = 30 * 24 * 3600_000;

export interface SnoozePreset {
  key: "1h" | "manana" | "1sem";
  label: string;
  until: (now: Date) => Date;
}

/** Mañana a las 09:00 (hora local del usuario). */
export function tomorrowAt9(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
  { key: "1h", label: "1h", until: (now) => new Date(now.getTime() + 3600_000) },
  { key: "manana", label: "Mañana 9:00", until: tomorrowAt9 },
  { key: "1sem", label: "1 semana", until: (now) => new Date(now.getTime() + 7 * 24 * 3600_000) },
];

/** ¿El instante es un snooze válido? (misma regla que la RPC: 1 min .. 30 días). */
export function isValidSnoozeUntil(until: Date, now: Date): boolean {
  const delta = until.getTime() - now.getTime();
  return delta >= SNOOZE_MIN_MS && delta <= SNOOZE_MAX_MS;
}
