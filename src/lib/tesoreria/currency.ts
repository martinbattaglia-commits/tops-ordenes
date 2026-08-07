// Fences monetarios de Tesorería (CCN-002 · Caja Chica Multimoneda).
//
// Regla de Dirección (Resolución 2026-07-28, D-2): NUNCA sumar ARS y USD.
// Los indicadores ARS existentes conservan su semántica actual; el USD sólo
// aparece como línea/tarjeta informativa SEPARADA, sin equivalencias ni
// cotización. Todo roll-up de saldos debe pasar por estos helpers para que el
// fence quede en UN solo lugar testeado y no dependa de cada página.

import { fmtCurrency, fmtCurrencyUsd } from "@/lib/utils";
import type { BankBalance } from "./types";

/** Monedas habilitadas para Caja Chica. La moneda vive en `bank_accounts`. */
export type CajaCurrency = "ARS" | "USD";

export const CAJA_CURRENCIES: readonly CajaCurrency[] = ["ARS", "USD"] as const;

export function isCajaCurrency(v: unknown): v is CajaCurrency {
  return v === "ARS" || v === "USD";
}

/** Fence: sólo filas ARS. Único filtro válido antes de un Σ de saldos ARS. */
export function onlyArs(balances: BankBalance[]): BankBalance[] {
  return balances.filter((b) => b.currency === "ARS");
}

/**
 * Σ de saldos EXCLUSIVAMENTE ARS. Reemplaza a los `reduce` directos de
 * hub/flujo/ejecutivo: con una caja USD activa, el total ARS no se contamina.
 */
export function sumArsBalances(balances: BankBalance[]): number {
  return onlyArs(balances).reduce((s, b) => s + (Number(b.balance) || 0), 0);
}

/**
 * Saldo de la Caja Chica USD si la cuenta existe, o null si aún no fue
 * habilitada (pre data-op). El null permite ocultar la línea informativa en
 * lugar de inventar un cero que sugiera una caja operativa.
 */
export function cajaUsdBalance(balances: BankBalance[]): number | null {
  const caja = balances.find((b) => b.account_type === "caja" && b.currency === "USD");
  return caja ? Number(caja.balance) || 0 : null;
}

/** Formatea un importe en su moneda nativa, con símbolo siempre visible. */
export function fmtCaja(currency: CajaCurrency, n: number | null | undefined): string {
  return currency === "USD" ? fmtCurrencyUsd(n) : fmtCurrency(n);
}
