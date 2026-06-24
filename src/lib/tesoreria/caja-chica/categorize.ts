// Categorización DETERMINÍSTICA por reglas (cash_box_category_rules).
// Sin IA / sin LLM. Normaliza para que no importen mayúsculas, tildes ni espacios.

import type { CategoryRule } from "./types";

export const FALLBACK_CATEGORIA = "Otros";

// Tras normalize("NFD"), las tildes quedan como marcas combinantes (categoría
// Unicode Mn). \p{Mn}/gu las elimina (á->a, é->e...). La ñ también se reduce a n
// (folding): solo afecta el KEY de matcheo, nunca el texto que se muestra.
const DIACRITICS = /\p{Mn}/gu;

/** Minúsculas, sin diacríticos, espacios colapsados, trim. */
export function normalizeText(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Quita solo diacríticos (para patrones regex, preservando metacaracteres y estructura). */
function stripDiacritics(s: string): string {
  return (s ?? "").normalize("NFD").replace(DIACRITICS, "");
}

/**
 * Devuelve la categoría de la regla ACTIVA de mayor prioridad (menor número)
 * que matchea el concepto, o null si ninguna matchea.
 */
export function matchCategoria(concepto: string, rules: CategoryRule[]): string | null {
  const nc = normalizeText(concepto);
  if (!nc) return null;
  const sorted = rules.filter((r) => r.activo).sort((a, b) => a.prioridad - b.prioridad);
  for (const r of sorted) {
    if (r.match_type === "regex") {
      try {
        if (new RegExp(stripDiacritics(r.pattern), "i").test(nc)) return r.categoria;
      } catch {
        // regex inválida en la regla -> se ignora (no rompe la categorización)
      }
      continue;
    }
    const np = normalizeText(r.pattern);
    if (!np) continue;
    if (r.match_type === "exact" && nc === np) return r.categoria;
    if (r.match_type === "contains" && nc.includes(np)) return r.categoria;
  }
  return null;
}

/** matchCategoria con fallback 'Otros'. Es lo que persiste el sync-engine. */
export function categorize(concepto: string, rules: CategoryRule[]): string {
  return matchCategoria(concepto, rules) ?? FALLBACK_CATEGORIA;
}
