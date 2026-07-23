/**
 * Compone la visibilidad de un artefacto derivado de MÚLTIPLES fuentes con la
 * regla del MÍNIMO COMÚN (Parte III §4.1 / ADR-MACL-5): el artefacto solo es
 * visible para quien pueda ver TODAS sus fuentes (semántica AND sobre el set).
 *
 * - Sin fuentes → fail-closed: ["staff"] (nunca abierto).
 * - "public_auth" es el constraint más débil (cualquier autenticado): si hay
 *   alguna clave más estricta, "public_auth" es redundante en un AND y se descarta.
 * - Devuelve el set deduplicado y ordenado de visibility_keys requeridas.
 */
export function requiredVisibilityKeys(sourceKeys: string[]): string[] {
  const set = new Set(sourceKeys.map((k) => k.trim()).filter(Boolean));
  if (set.size === 0) return ["staff"];
  if (set.size > 1) set.delete("public_auth");
  return Array.from(set).sort();
}
