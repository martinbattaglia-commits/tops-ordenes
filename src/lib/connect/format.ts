// Nexus Link · helpers de formato de tiempo (puros, client+server safe).

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

export function timeHM(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    timeZone: AR_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

// ── LINK-WA-UX-001 · Separadores de fecha por día ───────────────────────────
// Los hilos importados abarcan años (2021→2026): mostrar sólo la hora hace que
// un mensaje de 2021 y otro de 2026 se vean idénticos. Estos helpers son PUROS
// y la zona horaria es EXPLÍCITA (ART, la vigente del negocio) para que el
// agrupamiento por día no dependa de la zona del proceso ni del navegador.

/** Zona horaria vigente del negocio. Override sólo para pruebas. */
export const AR_TIME_ZONE = "America/Argentina/Buenos_Aires";

/** Clave de día ordenable (YYYY-MM-DD) en la zona indicada. Compara días, no instantes. */
export function dayKey(iso: string, timeZone: string = AR_TIME_ZONE): string {
  // en-CA rinde YYYY-MM-DD, que además es ordenable como string.
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

/** ¿Estos dos mensajes caen en días distintos? (null/undefined ⇒ hay que separar) */
export function isNewDay(iso: string, prevIso: string | null | undefined, timeZone: string = AR_TIME_ZONE): boolean {
  if (!prevIso) return true;
  return dayKey(iso, timeZone) !== dayKey(prevIso, timeZone);
}

/**
 * Etiqueta del separador:
 *   hoy            → "Hoy"
 *   ayer           → "Ayer"
 *   mismo año      → "lunes, 15 de julio"      (día y mes explícitos)
 *   año distinto   → "15 de julio de 2023"     (el AÑO se vuelve visible)
 */
export function dayLabel(
  iso: string,
  now: Date | null = new Date(),
  timeZone: string = AR_TIME_ZONE,
): string {
  const key = dayKey(iso, timeZone);
  // Durante SSR/hidratación el caller puede usar `null` como snapshot estable:
  // se muestra una fecha absoluta hasta que el reloj real se habilita post-mount.
  if (now === null) {
    return new Date(iso).toLocaleDateString("es-AR", {
      timeZone,
      year: "numeric",
      day: "numeric",
      month: "long",
    });
  }
  const todayKey = dayKey(now.toISOString(), timeZone);
  if (key === todayKey) return "Hoy";
  const yesterdayKey = dayKey(new Date(now.getTime() - 86_400_000).toISOString(), timeZone);
  if (key === yesterdayKey) return "Ayer";

  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4);
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone,
    ...(sameYear ? { weekday: "long" as const } : { year: "numeric" as const }),
    day: "numeric",
    month: "long",
  });
}
