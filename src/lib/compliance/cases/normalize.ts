/**
 * Diccionario de normalización (sinónimo → valor canónico).
 * Extensible POR DATOS: el motor recibe filas (DB) o usa DEFAULT_DICT como fallback.
 * Agregar términos = filas nuevas (tabla compliance_normalizacion), sin tocar este código.
 */
export type NormDimension = "estado" | "etapa" | "riesgo";
export interface NormRow { dimension: NormDimension; sinonimo: string; valorCanonico: string; }

/** Clave de comparación: minúsculas, sin acentos, espacios colapsados, trim. */
export function stripKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Fallback en código (espejo del seed de 0141). `sinonimo` ya viene normalizado con stripKey. */
const RAW: Array<[NormDimension, string, string]> = [
  ["estado", "en elaboracion", "en_tramite"],
  ["estado", "en analisis", "en_tramite"],
  ["estado", "en estudio", "en_tramite"],
  ["estado", "en proceso", "en_tramite"],
  ["estado", "en tramite", "en_tramite"],
  ["estado", "pendiente de resolucion", "en_tramite"],
  ["estado", "iniciado", "en_tramite"],
  ["estado", "abierto", "en_tramite"],
  ["estado", "en gestion", "en_tramite"],
  ["estado", "expediente abierto", "en_tramite"],
  ["estado", "pendiente de emision", "pendiente_emision"],
  ["estado", "pendiente emision", "pendiente_emision"],
  ["estado", "aprobado sin emitir", "pendiente_emision"],
  ["estado", "resolucion emitida sin certificado", "pendiente_emision"],
  ["estado", "a la firma", "pendiente_emision"],
  ["estado", "aprobado", "aprobado"],
  ["estado", "resuelto", "aprobado"],
  ["estado", "emitido", "aprobado"],
  ["estado", "finalizado", "aprobado"],
  ["estado", "otorgado", "aprobado"],
  ["estado", "favorable", "aprobado"],
  ["estado", "observado", "observado"],
  ["estado", "requerido", "observado"],
  ["estado", "con observaciones", "observado"],
  ["estado", "intimado", "observado"],
  ["estado", "a subsanar", "observado"],
  ["estado", "rechazado", "rechazado"],
  ["estado", "denegado", "rechazado"],
  ["estado", "desestimado", "rechazado"],
  ["estado", "archivado", "rechazado"],
  ["estado", "caducado", "rechazado"],
  ["estado", "vigente", "vigente"],
  ["estado", "en vigencia", "vigente"],
  ["estado", "al dia", "vigente"],
  ["estado", "sin iniciar", "sin_iniciar"],
  ["estado", "pendiente de inicio", "sin_iniciar"],
  ["etapa", "pronto despacho", "pronto_despacho"],
  ["etapa", "pronto despacho presentado", "pronto_despacho"],
  ["etapa", "esperando resolucion", "esperando_resolucion"],
  ["etapa", "elaboracion del proyecto de disposicion", "esperando_resolucion"],
  ["etapa", "presentado", "iniciado"],
  ["etapa", "subsanando", "subsanando"],
  ["etapa", "respondiendo observaciones", "subsanando"],
  ["riesgo", "bajo", "bajo"],
  ["riesgo", "medio", "medio"],
  ["riesgo", "alto", "alto"],
  ["riesgo", "critico", "critico"],
];
export const DEFAULT_DICT: NormRow[] = RAW.map(([dimension, sinonimo, valorCanonico]) => ({ dimension, sinonimo, valorCanonico }));

/**
 * Normaliza `texto` para la dimensión dada usando el diccionario.
 * Estrategia: match exacto por clave; si no, match por "contiene sinónimo".
 * Devuelve el valor canónico o null (degradación segura: el caller decide caer a fecha).
 */
export function normalizar(
  texto: string | null | undefined,
  dimension: NormDimension,
  dict: NormRow[] = DEFAULT_DICT,
): string | null {
  if (!texto) return null;
  const key = stripKey(texto);
  if (!key) return null;
  const rows = dict.filter((r) => r.dimension === dimension);
  // 1) match exacto
  const exact = rows.find((r) => r.sinonimo === key);
  if (exact) return exact.valorCanonico;
  // 2) match por inclusión (sinónimo más largo primero para evitar falsos positivos)
  const byLen = [...rows].sort((a, b) => b.sinonimo.length - a.sinonimo.length);
  const inc = byLen.find((r) => key.includes(r.sinonimo));
  return inc ? inc.valorCanonico : null;
}
