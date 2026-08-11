/**
 * operators.ts — LINK-WA S1 · Operadores sandbox del inbox WhatsApp.
 *
 * Corrección de diseño de Dirección: NO se siembra automáticamente a los
 * perfiles `role='admin'`. La incorporación de un perfil como participante de
 * un hilo WhatsApp vivo es una asignación EXPLÍCITA y DENY-BY-DEFAULT.
 *
 * Fuente única: `WHATSAPP_SANDBOX_OPERATOR_PROFILE_IDS` (UUIDs coma-separados,
 * default vacío). Vacío ⇒ ningún perfil se incorpora ⇒ el hilo queda sin
 * participante staff y, por la RLS de `connect_messages` (que exige membresía y
 * NO tiene bypass de admin), nadie lo lee. Ése es el estado seguro.
 *
 * Este módulo NO crea ni modifica roles, permisos, policies ni membresías
 * remotas: sólo decide qué IDs ya configurados son candidatos. La validación de
 * existencia/tenant vive en link-projection.ts y la autorización efectiva de
 * lectura sigue siendo la RLS.
 *
 * Funciones puras (env inyectable) — testeables sin red.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OperatorParseResult {
  /** UUIDs válidos, normalizados a minúsculas y deduplicados, en orden de aparición. */
  ids: string[];
  /** Entradas descartadas por no ser UUID. Se reportan para diagnóstico; nunca se usan. */
  invalid: string[];
}

/** ¿La cadena es un UUID canónico? */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Parsea la allowlist de operadores. Deny-by-default: sin variable, variable
 * vacía o sólo entradas inválidas ⇒ `ids` vacío.
 */
export function parseOperatorProfileIds(
  raw: string | undefined = process.env.WHATSAPP_SANDBOX_OPERATOR_PROFILE_IDS,
): OperatorParseResult {
  const ids: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const part of (raw ?? "").split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (!isUuid(token)) {
      invalid.push(token);
      continue;
    }
    const norm = token.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    ids.push(norm);
  }

  return { ids, invalid };
}

/**
 * ¿Este perfil está expresamente habilitado como operador sandbox?
 * Deny-by-default: allowlist vacía ⇒ siempre false.
 */
export function isOperatorAuthorized(
  profileId: string | null | undefined,
  allowlist: string[],
): boolean {
  if (!profileId) return false;
  const norm = profileId.trim().toLowerCase();
  if (!isUuid(norm)) return false;
  return allowlist.includes(norm);
}
