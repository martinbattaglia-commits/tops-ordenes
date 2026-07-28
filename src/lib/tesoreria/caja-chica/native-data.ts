// Data layer NATIVO de Caja Chica (CCN-001B · F3). Server-only (sin "use client").
//
// Caja Chica es un MÓDULO INDEPENDIENTE de Nexus ERP que REUTILIZA la
// infraestructura transaccional y de auditoría del motor de Tesorería.
// No es un motor paralelo: el libro es `treasury_movements` (type='caja_chica')
// y el saldo lo deriva la BASE en `treasury_bank_balances` (D1/D5: ningún saldo
// autoritativo se calcula en TS).
//
// Lee con createClient() (sesión anon + RLS). La escritura NO pasa por acá:
// va por las RPC `caja_chica_*` desde las server actions.

import { createClient } from "@/lib/supabase/server";
import type { CajaCurrency } from "@/lib/tesoreria/currency";

export type CajaDirection = "ingreso" | "egreso";
export type CajaStatus = "pendiente" | "confirmado" | "anulado";

/** Una fila del historial nativo (vista `v_cash_box_libro`, F1 + moneda en 0210). */
export interface CajaMovRow {
  movement_id: string;
  public_id: string;
  date: string; // yyyy-MM-dd
  direction: CajaDirection;
  amount: number;
  concepto: string;
  status: CajaStatus;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  responsable_id: string | null;
  responsable: string | null;
  observaciones: string | null;
  /** Moneda nativa del movimiento (heredada de su cuenta vía la vista, 0210). */
  currency: CajaCurrency;
}

/** Perfil elegible como responsable del movimiento. */
export interface Responsable {
  id: string;
  full_name: string;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Historial nativo de UNA caja. La vista ya filtra `type='caja_chica'` y ordena
 * cronológico descendente; acá no se reordena ni se recalcula nada.
 * CCN-002: el scope por moneda se resuelve EN LA QUERY (columna `currency`
 * expuesta por 0210) — nunca se mezclan cajas en memoria.
 */
export async function listCajaMovimientos(currency: CajaCurrency): Promise<CajaMovRow[]> {
  const s = createClient();
  if (!s) return [];
  const { data, error } = await s.from("v_cash_box_libro").select("*").eq("currency", currency);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    movement_id: String(r.movement_id),
    public_id: r.public_id ?? "",
    date: r.date ?? "",
    direction: (r.direction as CajaDirection) ?? "egreso",
    amount: num(r.amount),
    concepto: r.concepto ?? "",
    status: (r.status as CajaStatus) ?? "confirmado",
    voided_at: r.voided_at ?? null,
    void_reason: r.void_reason ?? null,
    created_at: r.created_at ?? "",
    responsable_id: r.responsable_id ?? null,
    responsable: r.responsable ?? null,
    observaciones: r.observaciones ?? null,
    currency: (r.currency as CajaCurrency) ?? currency,
  }));
}

/**
 * Saldo autoritativo de la cuenta Caja DE UNA MONEDA: `opening_balance + Σ
 * confirmados`. Sale de la MISMA vista que usan Galicia y Santander.
 *
 * CCN-002: la consulta se acota SIEMPRE por (account_type, currency) — con dos
 * cajas activas, el viejo filtro por account_type solo devolvía 2 filas y
 * `maybeSingle()` tiraba la página entera. La unicidad (una caja activa por
 * moneda) la garantiza el índice parcial de 0210.
 *
 * Devuelve null si la caja de esa moneda no existe todavía (p. ej. USD antes
 * del data-op de alta): la UI lo muestra como "caja no habilitada", no como 0.
 */
export async function getCajaSaldoErp(currency: CajaCurrency): Promise<number | null> {
  const s = createClient();
  if (!s) return null;
  const { data, error } = await s
    .from("treasury_bank_balances")
    .select("balance")
    .eq("account_type", "caja")
    .eq("currency", currency)
    .maybeSingle();
  if (error) throw error;
  return data ? num(data.balance) : null;
}

/** Responsables disponibles para el alta (perfiles activos, alfabético). */
export async function listResponsables(): Promise<Responsable[]> {
  const s = createClient();
  if (!s) return [];
  const { data, error } = await s
    .from("profiles")
    .select("id, full_name")
    .eq("active", true)
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.full_name)
    .map((r) => ({ id: String(r.id), full_name: String(r.full_name) }));
}
