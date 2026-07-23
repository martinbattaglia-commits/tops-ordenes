/**
 * Data accessors del módulo Contabilidad (F6 · piloto en modo SIMULATION).
 *
 * SOLO LECTURA. Todas las consultas van contra las vistas SQL del motor
 * contable (creadas por migraciones 0083/0084 del motor) y los catálogos.
 * Esta capa NO invoca `acc_create_posted_entry`, NO postea, NO revierte,
 * NO modifica catálogos. El posteo real está sellado por P6 (dry-run
 * permanente) hasta ratificación de la Contadora y decisión de Dirección.
 *
 * Mismo patrón que `src/lib/erp/accounting-data.ts`: producción = Supabase
 * (RLS `contabilidad.view`), demo = datasets vacíos (el motor nunca posteó,
 * el vacío es el estado real).
 */

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type {
  AsientoDescuadrado,
  ComprobanteSinAsiento,
  ConciliacionIvaRow,
  LibroDiarioFilters,
  LibroDiarioRow,
  LibroMayorFilters,
  LibroMayorRow,
  MotorStatus,
  SumasSaldosRow,
} from "./types";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

function requireClient() {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase client unavailable");
  return supabase;
}

/** Tope duro de filas por consulta de libro (el piloto no pagina todavía). */
const MAX_ROWS = 500;

// ------------------------------------------------------------------
// Estado del motor (dashboard)
// ------------------------------------------------------------------

export async function getMotorStatus(): Promise<MotorStatus> {
  if (isMock()) {
    return { asientos: 0, comprobantesPendientes: 0, descuadrados: 0, periodos: 0, cuentasActivas: 0, reglas: 0 };
  }
  const supabase = requireClient();

  const head = { count: "exact" as const, head: true };
  const [je, pend, desc, per, coa, rules] = await Promise.all([
    supabase.from("journal_entries").select("*", head),
    supabase.from("v_comprobantes_sin_asiento").select("*", head),
    supabase.from("v_asientos_descuadrados").select("*", head),
    supabase.from("accounting_periods").select("*", head),
    supabase.from("chart_of_accounts").select("*", head).eq("is_active", true),
    supabase.from("accounting_rules").select("*", head),
  ]);
  for (const r of [je, pend, desc, per, coa, rules]) {
    if (r.error) throw r.error;
  }

  return {
    asientos: je.count ?? 0,
    comprobantesPendientes: pend.count ?? 0,
    descuadrados: desc.count ?? 0,
    periodos: per.count ?? 0,
    cuentasActivas: coa.count ?? 0,
    reglas: rules.count ?? 0,
  };
}

// ------------------------------------------------------------------
// Libro Diario
// ------------------------------------------------------------------

export async function getLibroDiario(filters: LibroDiarioFilters): Promise<LibroDiarioRow[]> {
  if (isMock()) return [];
  const supabase = requireClient();

  let q = supabase
    .from("v_libro_diario")
    .select("*")
    .gte("entry_date", filters.desde)
    .lte("entry_date", filters.hasta)
    .order("entry_number", { ascending: true })
    .order("line_no", { ascending: true })
    .limit(MAX_ROWS);

  if (filters.sourceType) q = q.eq("source_type", filters.sourceType);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as LibroDiarioRow[];
}

// ------------------------------------------------------------------
// Libro Mayor
// ------------------------------------------------------------------

export async function getLibroMayor(filters: LibroMayorFilters): Promise<LibroMayorRow[]> {
  if (isMock()) return [];
  if (!filters.accountId) return [];
  const supabase = requireClient();

  const { data, error } = await supabase
    .from("v_libro_mayor")
    .select("*")
    .eq("account_id", filters.accountId)
    .gte("entry_date", filters.desde)
    .lte("entry_date", filters.hasta)
    .order("entry_date", { ascending: true })
    .order("entry_number", { ascending: true })
    .limit(MAX_ROWS);

  if (error) throw error;
  return (data ?? []) as LibroMayorRow[];
}

// ------------------------------------------------------------------
// Balance de Sumas y Saldos
// ------------------------------------------------------------------

export async function getSumasYSaldos(): Promise<SumasSaldosRow[]> {
  if (isMock()) return [];
  const supabase = requireClient();

  const { data, error } = await supabase
    .from("v_balance_sumas_saldos")
    .select("*")
    .order("cuenta_codigo", { ascending: true })
    .limit(MAX_ROWS);

  if (error) throw error;
  return (data ?? []) as SumasSaldosRow[];
}

// ------------------------------------------------------------------
// Comprobantes sin asiento (backlog contabilizable)
// ------------------------------------------------------------------

export async function getComprobantesSinAsiento(): Promise<ComprobanteSinAsiento[]> {
  if (isMock()) return [];
  const supabase = requireClient();

  const { data, error } = await supabase
    .from("v_comprobantes_sin_asiento")
    .select("*")
    .order("fecha", { ascending: true })
    .limit(MAX_ROWS);

  if (error) throw error;
  return (data ?? []) as ComprobanteSinAsiento[];
}

// ------------------------------------------------------------------
// Conciliación IVA fiscal ↔ contable
// ------------------------------------------------------------------

export async function getConciliacionIva(): Promise<ConciliacionIvaRow[]> {
  if (isMock()) return [];
  const supabase = requireClient();

  const { data, error } = await supabase
    .from("v_iva_fiscal_vs_contable")
    .select("*")
    .order("periodo", { ascending: false })
    .limit(60);

  if (error) throw error;
  return (data ?? []) as ConciliacionIvaRow[];
}

// ------------------------------------------------------------------
// Asientos descuadrados (control redundante — debe estar siempre vacío)
// ------------------------------------------------------------------

export async function getAsientosDescuadrados(): Promise<AsientoDescuadrado[]> {
  if (isMock()) return [];
  const supabase = requireClient();

  const { data, error } = await supabase
    .from("v_asientos_descuadrados")
    .select("*")
    .order("entry_number", { ascending: true })
    .limit(100);

  if (error) throw error;
  return (data ?? []) as AsientoDescuadrado[];
}
