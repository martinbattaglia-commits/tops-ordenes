// Data layer del dashboard de Caja Chica. Server-only (sin "use client").
// Lee EXCLUSIVAMENTE las 2 vistas con createClient() (anon + RLS). Los saldos
// se derivan en la base (vista), nunca en TS (principio D1/D5).

import { createClient } from "@/lib/supabase/server";
import type { CashBoxDirection, SaldoSource } from "./types";

export interface ResumenRow {
  periodo: number;
  total_acreditado: number;
  total_gasto: number;
  movimientos: number;
  saldo_calculado: number;
  saldo_excel: number | null;
  saldo_delta: number | null;
  saldo_source: SaldoSource | null;
  ultimo_snapshot: string | null;
  last_run_id: string | null;
  last_status: string | null;
  last_warnings: number | null;
  ultima_sync: string | null;
}

export interface MovRow {
  id: string;
  periodo: number;
  direction: CashBoxDirection;
  tx_date: string | null;
  tx_date_raw: string;
  concepto: string;
  importe: number;
  categoria: string;
  source_row: number;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/** Ejercicios disponibles (para el filtro de período), más reciente primero. */
export async function listPeriodos(): Promise<number[]> {
  const s = createClient();
  if (!s) return [];
  const { data, error } = await s.from("v_cash_box_resumen").select("periodo").order("periodo", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => Number(r.periodo));
}

/** Resumen (KPIs + conciliación + última sync) de un ejercicio. */
export async function getResumen(periodo: number): Promise<ResumenRow | null> {
  const s = createClient();
  if (!s) return null;
  const { data, error } = await s.from("v_cash_box_resumen").select("*").eq("periodo", periodo).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    periodo: Number(data.periodo),
    total_acreditado: num(data.total_acreditado),
    total_gasto: num(data.total_gasto),
    movimientos: num(data.movimientos),
    saldo_calculado: num(data.saldo_calculado),
    saldo_excel: data.saldo_excel == null ? null : num(data.saldo_excel),
    saldo_delta: data.saldo_delta == null ? null : num(data.saldo_delta),
    saldo_source: (data.saldo_source as SaldoSource | null) ?? null,
    ultimo_snapshot: data.ultimo_snapshot ?? null,
    last_run_id: data.last_run_id ?? null,
    last_status: data.last_status ?? null,
    last_warnings: data.last_warnings == null ? null : num(data.last_warnings),
    ultima_sync: data.ultima_sync ?? null,
  };
}

/** Movimientos de un ejercicio (todo el período; el filtrado de la tabla es en server). */
export async function listMovimientos(periodo: number): Promise<MovRow[]> {
  const s = createClient();
  if (!s) return [];
  const { data, error } = await s
    .from("v_cash_box_movimientos")
    .select("*")
    .eq("periodo", periodo)
    .order("tx_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: String(r.id),
    periodo: Number(r.periodo),
    direction: r.direction as CashBoxDirection,
    tx_date: r.tx_date ?? null,
    tx_date_raw: r.tx_date_raw ?? "",
    concepto: r.concepto ?? "",
    importe: num(r.importe),
    categoria: r.categoria ?? "Otros",
    source_row: Number(r.source_row),
  }));
}
