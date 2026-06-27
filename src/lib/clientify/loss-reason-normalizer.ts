/**
 * LossReasonNormalizer
 *
 * Unifica el texto libre de lost_reason que llega de Clientify hacia un conjunto
 * canónico de categorías. El CRM permite texto libre, lo que genera variantes
 * ("Price", "Precio", "precio", entradas mal escritas, etc.).
 *
 * Categorías canónicas:
 *   Precio          — competitividad de precio
 *   Condiciones     — restricciones operativas/comerciales
 *   No contesta / N/A — falla en seguimiento
 *   Otros           — motivos varios capturados pero no clasificables
 *   Sin clasificar  — campo vacío/null en deals perdidos
 */

export const CANONICAL_REASONS = [
  "Precio",
  "Condiciones",
  "No contesta / N/A",
  "Otros",
  "Sin clasificar",
] as const;

export type CanonicalReason = (typeof CANONICAL_REASONS)[number];

/** Reglas de normalización: primera que coincide gana. */
const RULES: Array<{ test: (s: string) => boolean; canonical: CanonicalReason }> = [
  // Precio
  { test: (s) => /precio/i.test(s) || /price/i.test(s), canonical: "Precio" },

  // Condiciones
  {
    test: (s) =>
      /condici/i.test(s) ||
      /condition/i.test(s) ||
      /disponibilidad/i.test(s) ||
      /espacio/i.test(s) ||
      /capacidad/i.test(s),
    canonical: "Condiciones",
  },

  // No contesta / N/A
  {
    test: (s) =>
      /no\s*contesta/i.test(s) ||
      /\bn[\/\\]a\b/i.test(s) ||
      /no\s*responde/i.test(s) ||
      /sin\s*respuesta/i.test(s) ||
      /unreachable/i.test(s),
    canonical: "No contesta / N/A",
  },

  // Otros (catch-all para texto reconocible pero no clasificado arriba)
  { test: (s) => /otro/i.test(s) || /other/i.test(s), canonical: "Otros" },
];

/**
 * Normaliza el campo lost_reason recibido de Clientify.
 *
 * - null / string vacío / solo espacios → "Sin clasificar"
 *   (solo se almacena "Sin clasificar" para deals perdidos; para deals activos
 *    el campo debe quedar null, responsabilidad del caller)
 * - String que coincide con una regla → categoría canónica
 * - String no reconocido → "Otros" (no se descarta información)
 */
export function normalizeLossReason(
  raw: string | null | undefined
): CanonicalReason {
  if (!raw || raw.trim() === "") return "Sin clasificar";
  const s = raw.trim();
  for (const rule of RULES) {
    if (rule.test(s)) return rule.canonical;
  }
  return "Otros";
}

/**
 * Devuelve true si el valor ya es una categoría canónica exacta.
 * Útil para decidir si re-normalizar o dejar como está.
 */
export function isCanonical(value: string | null | undefined): boolean {
  return CANONICAL_REASONS.includes(value as CanonicalReason);
}
