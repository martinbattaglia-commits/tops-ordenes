/**
 * Coherencia banco↔cuenta para la ingesta de extractos (TREAS-RECON-001 · E2).
 *
 * Origen: hallazgo E1 — los extractos Santander del piloto quedaron asociados
 * a la cuenta "Caja / Caja Efectivo" porque la página pasaba `accounts[0]`.
 * Regla: el error debe ser VISIBLE y explícito; prohibido continuar en
 * silencio. Este validador es PURO (testeable); la RPC repite las mismas
 * verificaciones en la base (defensa en profundidad).
 */
import type { Banco } from "./types";

export interface CuentaParaIngesta {
  id: string;
  bank_name: string;
  account_name: string;
  account_type: string;
  currency: string | null;
  active: boolean;
}

/** Dominio CERRADO de bancos soportados por este expediente. */
export const BANCOS_SOPORTADOS = ["santander", "galicia"] as const;

/** Normaliza y valida contra el dominio. Devuelve null si no pertenece.
 *  Rechaza vacío y genéricos: la comparación por substring de la versión
 *  previa dejaba pasar `""` y `"banco"` (`position('' in x)` = 1). */
export function normalizarBanco(valor: string | null | undefined): Banco | null {
  const v = (valor ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return (BANCOS_SOPORTADOS as readonly string[]).includes(v) ? (v as Banco) : null;
}

/** Resuelve el banco del dominio al que pertenece una cuenta, por mapa
 *  explícito — nunca por coincidencia parcial ambigua. */
export function bancoDeLaCuenta(bankName: string): Banco | null {
  const n = (bankName ?? "").toLowerCase();
  if (n.includes("santander")) return "santander";
  if (n.includes("galicia")) return "galicia";
  return null;
}

/** Devuelve el mensaje de rechazo, o null si la combinación es válida. */
export function validarCoherenciaCuenta(
  banco: Banco | string | null | undefined,
  cuenta: CuentaParaIngesta | null | undefined
): string | null {
  const b = normalizarBanco(typeof banco === "string" ? banco : banco ?? "");
  if (!b) {
    const crudo = (banco ?? "").toString().trim();
    return crudo === ""
      ? "Indicá el banco del extracto."
      : `Banco «${crudo}» no soportado. Sólo se admiten: ${BANCOS_SOPORTADOS.join(", ")}.`;
  }
  if (!cuenta) return "La cuenta seleccionada no existe.";
  if (!cuenta.active) {
    return `La cuenta «${cuenta.account_name}» está inactiva; no admite ingesta de extractos.`;
  }
  if (cuenta.account_type === "caja") {
    return `La cuenta «${cuenta.account_name}» es una caja. La conciliación bancaria requiere una cuenta bancaria (el extracto ${bancoLabel(b)} no puede asociarse a Caja).`;
  }
  if (bancoDeLaCuenta(cuenta.bank_name) !== b) {
    return `El extracto es de ${bancoLabel(b)} pero la cuenta «${cuenta.account_name}» pertenece a ${cuenta.bank_name}. Elegí la cuenta del banco correcto.`;
  }
  if (cuenta.currency && cuenta.currency !== "ARS") {
    return `La cuenta «${cuenta.account_name}» opera en ${cuenta.currency}; el pipeline actual sólo soporta ARS.`;
  }
  return null;
}

export function bancoLabel(banco: Banco): string {
  return banco === "santander" ? "Santander" : "Galicia";
}
