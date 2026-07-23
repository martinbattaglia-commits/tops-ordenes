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

export type CajaDirection = "ingreso" | "egreso";
export type CajaStatus = "pendiente" | "confirmado" | "anulado";

/** Una fila del historial nativo (vista `v_cash_box_libro`, F1). */
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
}

/** Perfil elegible como responsable del movimiento. */
export interface Responsable {
  id: string;
  full_name: string;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Historial nativo. La vista ya filtra `type='caja_chica'` y ordena cronológico
 * descendente; acá no se reordena ni se recalcula nada.
 */
export async function listCajaMovimientos(): Promise<CajaMovRow[]> {
  const s = createClient();
  if (!s) return [];
  const { data, error } = await s.from("v_cash_box_libro").select("*");
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
  }));
}

/**
 * Saldo autoritativo de la cuenta Caja: `opening_balance + Σ confirmados`.
 * Sale de la MISMA vista que usan Galicia y Santander. Devuelve null si todavía
 * no hay cuenta de caja visible para el usuario.
 */
export async function getCajaSaldoErp(): Promise<number | null> {
  const s = createClient();
  if (!s) return null;
  const { data, error } = await s
    .from("treasury_bank_balances")
    .select("balance")
    .eq("account_type", "caja")
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
