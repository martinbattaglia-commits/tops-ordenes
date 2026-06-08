/**
 * Pipelines comerciales visibles en TOPS NEXUS (fuente única de verdad).
 *
 * El tenant tiene en Clientify un pipeline histórico catch-all ("Logística Tops")
 * que NO corresponde al flujo comercial activo y genera ruido. CRM360 y la página
 * Pipeline (Clientify live) deben mostrar únicamente los 3 pipelines operativos:
 *   - ANMAT
 *   - Cargas Generales
 *   - Oficinas (alquiler de oficinas)
 *
 * Es un filtro VISUAL DE LECTURA: no borra datos, no toca Clientify, no toca
 * sincronización ni backfill. Solo decide qué se renderiza.
 *
 * Match case-insensitive y trim. Tolerante a variantes/typos del nombre.
 */
export const VISIBLE_PIPELINE_NAMES: ReadonlySet<string> = new Set([
  "anmat",
  "alquiler de oficinas",
  "oficinas",
  "oficinas corporativas",
  "carga generales",
  "cargas generales", // tolerante a typo
]);

/** Pipeline histórico catch-all explícitamente excluido (a efectos de documentación/log). */
export const EXCLUDED_PIPELINE_NAMES: ReadonlySet<string> = new Set([
  "logistica tops",
  "logística tops",
]);

/** Normaliza un nombre de pipeline para comparar. */
function norm(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * ¿El pipeline debe verse en el flujo comercial activo?
 * `true` solo para ANMAT / Cargas Generales / Oficinas.
 */
export function isVisibleCommercialPipeline(name: string | null | undefined): boolean {
  return VISIBLE_PIPELINE_NAMES.has(norm(name));
}
