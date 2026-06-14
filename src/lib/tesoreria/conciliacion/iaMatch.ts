/**
 * Adapter de similitud semántica para la Capa 4 (IA) — Conciliación Bancaria IA.
 *
 * El motor de matching (`matching.ts`) es PURO: no llama a ningún LLM. Recibe un
 * `SimTextoFn` inyectado que devuelve 0..1 de similitud entre la descripción de
 * la línea del extracto y la del movimiento Nexus.
 *
 *  - PRODUCCIÓN: un adapter que use el proveedor IA del proyecto (OpenAI/Claude,
 *    decisión D6) — wiring documentado abajo, NO se invoca en Sprint 2.
 *  - TESTS / FALLBACK: `deterministicSimTexto`, basado en solapamiento de tokens
 *    de nombre (Jaccard) — determinista, sin red, suficiente para validar el
 *    motor y como fallback barato cuando la IA no está disponible.
 *
 * OB6 (corroboración de entidad): la Capa 4 SÓLO matchea si hay coincidencia de
 * CUIT o una similitud de texto fuerte — la IA nunca inventa un match sin
 * corroboración. Ese gate vive en `matching.ts`; acá sólo se computa el score.
 */

export type SimTextoFn = (lineaDesc: string, movDesc: string) => number;

const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "y", "a", "sa", "srl", "s", "r", "l",
  "saci", "sacif", "var", "fac", "factura", "facturas", "transferencia",
  "inmediata", "recibida", "pago", "proveedores", "recibido", "credito",
  "debito", "online", "banking", "emp", "cash",
]);

function tokens(s: string): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z0-9\s]/g, " ") // quita acentos (combining marks) y puntuación
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
}

/** Jaccard de tokens (0..1). Determinista, sin red. */
export const deterministicSimTexto: SimTextoFn = (a, b) => {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
};

/**
 * WIRING DE PRODUCCIÓN (D6 — NO se invoca en Sprint 2).
 *
 * export function llmSimTexto(client): SimTextoFn {
 *   return async (lineaDesc, movDesc) => {
 *     // Prompt acotado: "¿Refieren a la misma operación/contraparte? 0..1".
 *     // Usar el proveedor definido en D6 (Claude recomendado por OB11/egress) con
 *     // los datos ya REDACTADOS (sin CBU). Cachear por (hash línea, hash mov).
 *   };
 * }
 *
 * Nota: para mantener el motor síncrono y puro en S2, la integración real
 * pre-computa las similitudes IA por lote y las inyecta como `SimTextoFn`
 * memoizada. La IA NUNCA decide sola: sólo aporta el score `simTxt`.
 */
