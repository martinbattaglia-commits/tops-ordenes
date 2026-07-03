/**
 * sandbox.ts — F4.4-E3 · Modo sandbox del canal WhatsApp (D-F44-3).
 *
 * Mientras `WHATSAPP_SANDBOX` no sea explícitamente "0", TODO envío saliente
 * queda restringido a la allowlist de números internos
 * (`WHATSAPP_SANDBOX_ALLOWLIST`, E.164 separados por coma). Fail-closed por
 * diseño: sin flag ⇒ sandbox ON; sandbox ON + allowlist vacía ⇒ nada sale.
 * Pasar el flag a "0" (productivo) es decisión de Dirección en F5.
 *
 * Funciones puras (env inyectable) — testeables sin red.
 */

/** Sandbox ON salvo opt-out explícito con "0". */
export function isSandboxEnabled(
  flag: string | undefined = process.env.WHATSAPP_SANDBOX,
): boolean {
  return (flag ?? "1").trim() !== "0";
}

/** Normaliza un MSISDN a solo dígitos (Meta acepta E.164 con o sin '+'). */
export function normalizeMsisdn(value: string): string {
  return value.replace(/\D/g, "");
}

/** Parsea la allowlist desde env (coma-separada, tolera espacios y vacíos). */
export function parseAllowlist(
  raw: string | undefined = process.env.WHATSAPP_SANDBOX_ALLOWLIST,
): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => normalizeMsisdn(s.trim()))
    .filter((s) => s.length > 0);
}

/** ¿El destino está permitido en sandbox? (allowlist vacía ⇒ nada permitido). */
export function isDestinationAllowed(to: string, allowlist: string[]): boolean {
  const target = normalizeMsisdn(to);
  if (!target) return false;
  return allowlist.includes(target);
}

export type SandboxDecision =
  | { allowed: true; sandbox: boolean }
  | { allowed: false; sandbox: true; reason: "destination_not_allowlisted" };

/** Decisión completa para un envío saliente. */
export function checkOutboundAllowed(
  to: string,
  opts?: { flag?: string; allowlistRaw?: string },
): SandboxDecision {
  const sandbox = isSandboxEnabled(opts?.flag ?? process.env.WHATSAPP_SANDBOX);
  if (!sandbox) return { allowed: true, sandbox: false };
  const allowlist = parseAllowlist(opts?.allowlistRaw ?? process.env.WHATSAPP_SANDBOX_ALLOWLIST);
  return isDestinationAllowed(to, allowlist)
    ? { allowed: true, sandbox: true }
    : { allowed: false, sandbox: true, reason: "destination_not_allowlisted" };
}
