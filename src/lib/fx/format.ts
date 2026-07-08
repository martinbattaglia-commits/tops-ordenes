/**
 * Helpers PUROS de presentación para la card de dólar (sin React, sin IO).
 * Se extraen del componente para poder testear el formateo y la resolución de
 * estado sin necesidad de un entorno DOM (vitest corre en `node`).
 */

const AR_TZ = "America/Argentina/Buenos_Aires";

/**
 * Formatea un monto ARS como "ARS 1.515,00" (separador de miles con punto,
 * coma decimal, 2 decimales fijos) — coincide con el mockup del KPI. Se usa
 * prefijo "ARS " (código de moneda) en vez del "$ " transaccional de Tesorería
 * porque acá se exhibe un par de cambio, no un importe imputable.
 */
export function fmtArs(n: number): string {
  return (
    "ARS " +
    n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/**
 * "HH:mm" en horario de Argentina a partir de un ISO. null si el ISO es
 * inválido o ausente (la card entonces omite el "Actualizado HH:mm").
 */
export function fmtHoraAr(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: AR_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

export type FxCardKind = "loading" | "unavailable" | "stale" | "loaded";

/**
 * Deriva el estado visual de la card a partir de sus props. Orden de
 * precedencia: loading → no disponible → último dato (stale) → cargado.
 */
export function resolveFxCardKind(p: {
  loading?: boolean;
  error?: boolean;
  sell: number | null | undefined;
  status?: "fresh" | "stale" | "unavailable";
  stale?: boolean;
}): FxCardKind {
  if (p.loading) return "loading";
  if (p.error || p.status === "unavailable" || p.sell == null) return "unavailable";
  if (p.stale || p.status === "stale") return "stale";
  return "loaded";
}
