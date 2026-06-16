/**
 * classify.ts — Clasificación determinística de documentos regulatorios de Drive.
 *
 * A partir del nombre de archivo y la ruta de carpetas (folderPath) infiere:
 *   · sede        → MAGALDI | LUJAN | null
 *   · categoria   → una de las 12 categorías del cockpit (o null)
 *   · tipo_doc    → etiqueta legible del instrumento
 *   · fechas      → emisión / vencimiento extraídas del nombre (best-effort)
 *
 * Todo es heurístico y conservador: ante la duda devuelve null en vez de adivinar.
 * El parseo profundo del contenido del PDF queda fuera (opt-in, fase futura).
 */

import type { Sede } from "@/lib/compliance/data";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Texto combinado de nombre + ruta para matching. */
function haystack(name: string, folderPath: string[]): string {
  return norm([...folderPath, name].join(" / "));
}

export function classifySede(name: string, folderPath: string[]): Sede | null {
  const h = haystack(name, folderPath);
  // Luján: nombre de calle (Pedro de Luján) o "lujan".
  if (/\blujan\b|pedro de lujan|\b3159\b|\b3151\b/.test(h)) return "LUJAN";
  // Magaldi: "magaldi" o la altura 1765.
  if (/\bmagaldi\b|\b1765\b/.test(h)) return "MAGALDI";
  return null;
}

/** Reglas categoría: primer match gana (orden = especificidad). */
const CATEGORIA_RULES: { categoria: string; re: RegExp }[] = [
  { categoria: "ANMAT", re: /\banmat\b/ },
  { categoria: "ACUMAR", re: /\bacumar\b|reamar|\bcurt\b|matanza|riachuelo/ },
  { categoria: "Impacto Ambiental", re: /aptitud ambiental|\bcaa\b|impacto ambiental|impacto acustico|\brac\b|\bapra\b|dgeva|ley 123/ },
  { categoria: "Residuos", re: /residuo|peligros|manifiesto|\by8\b|\by12\b|generador/ },
  { categoria: "Incendio", re: /incendio|ifci|hidrant|manga|carga de fuego|matafueg|extintor/ },
  { categoria: "Simulacros", re: /simulacro|autoproteccion|\bsap\b|defensa civil|dgdciv|ley 5920/ },
  { categoria: "Electricidad", re: /puesta a tierra|\bpat\b|cetpd|copime|continuidad/ },
  { categoria: "Plagas", re: /plaga|desinsect|desratiz|fumigac/ },
  { categoria: "Agua", re: /tanque|potabil|bacteriolog|fisicoquimic|\bagua\b/ },
  { categoria: "Seguros", re: /seguro|poliza|\bssn\b|responsabilidad civil/ },
  { categoria: "Habilitación", re: /habilitacion|conservacion|ventilacion|montacarg|ascensor|oblea|plancheta|plano/ },
  { categoria: "Seguridad", re: /capacitacion|seguridad e higiene|matafueg/ },
];

export function classifyCategoria(name: string, folderPath: string[]): string | null {
  const h = haystack(name, folderPath);
  for (const r of CATEGORIA_RULES) {
    if (r.re.test(h)) return r.categoria;
  }
  return null;
}

/** Tipo documental legible (subconjunto, best-effort). */
export function classifyTipo(name: string, folderPath: string[]): string {
  const h = haystack(name, folderPath);
  if (/oblea/.test(h)) return "Oblea";
  if (/certificad/.test(h)) return "Certificado";
  if (/disposicion|\bdi-\b|disp\b/.test(h)) return "Disposición";
  if (/poliza|seguro/.test(h)) return "Póliza";
  if (/plano|plancheta/.test(h)) return "Plano / Plancheta";
  if (/manifiesto/.test(h)) return "Manifiesto";
  if (/ddjj|declaracion jurada|reempadron/.test(h)) return "DDJJ";
  if (/acta|inspeccion/.test(h)) return "Acta / Inspección";
  if (/constancia|capacitacion/.test(h)) return "Constancia";
  if (/informe|estudio|medicion/.test(h)) return "Informe / Estudio";
  return "Documento";
}

const MESES: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
  may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
  sep: 9, sept: 9, septiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11,
  dic: 12, diciembre: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Devuelve YYYY-MM-DD si la fecha es razonable (2000-2099), o null. */
function toIso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Extrae la primera fecha reconocible de un texto. Soporta:
 *   dd-mm-yyyy · dd/mm/yyyy · yyyy-mm-dd · "mes 2026" · "2026".
 * Devuelve YYYY-MM-DD (día 1 si sólo hay mes/año) o null.
 */
export function extractDate(text: string): string | null {
  const t = norm(text);

  // yyyy-mm-dd o yyyy_mm_dd
  let m = t.match(/(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/);
  if (m) return toIso(+m[1], +m[2], +m[3]);

  // dd-mm-yyyy o dd/mm/yyyy
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);
  if (m) return toIso(+m[3], +m[2], +m[1]);

  // "mes yyyy" (texto)
  m = t.match(/\b([a-z]{3,12})[ _-]+(20\d{2})\b/);
  if (m && MESES[m[1]]) return toIso(+m[2], MESES[m[1]], 1);

  // mm-yyyy
  m = t.match(/\b(\d{1,2})[-/.](20\d{2})\b/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return toIso(+m[2], +m[1], 1);

  // sólo año
  m = t.match(/\b(20\d{2})\b/);
  if (m) return toIso(+m[1], 1, 1);

  return null;
}

export interface ExtractedDates {
  emision: string | null;
  vencimiento: string | null;
}

/**
 * Intenta separar fecha de emisión y de vencimiento del nombre del archivo.
 * Si el nombre contiene una pista de vencimiento ("venc", "vto", "vence",
 * "vigencia hasta") cerca de una fecha, esa se toma como vencimiento.
 */
export function extractDates(name: string): ExtractedDates {
  const t = norm(name);
  let vencimiento: string | null = null;

  const vencHint = t.match(/(venc\w*|vto|vence|vigencia hasta|valido hasta|hasta)[ :._-]*([^|]*)/);
  if (vencHint) vencimiento = extractDate(vencHint[2]);

  // Emisión: primera fecha del nombre (que no sea la de vencimiento).
  let emision = extractDate(t);
  if (emision && emision === vencimiento) emision = null;

  return { emision, vencimiento };
}
