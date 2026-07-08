import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { AccountType, ChartAccount, AccountingRule } from "./types";

/**
 * Data accessors del Plan de Cuentas (chart_of_accounts) y reglas de
 * imputación (accounting_rules). Read-only. Mismo patrón que
 * `src/lib/erp/data.ts`: producción = Supabase (RLS), demo = mock en memoria.
 *
 * El catálogo es la fuente única para la clasificación contable usada por
 * legajos (proveedores/clientes), facturas, reportes, balance y futuras
 * automatizaciones contables. NO hardcodear listas de cuentas en otros módulos:
 * consumir siempre `listChartOfAccounts()`.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ------------------------------------------------------------------
// Mock (demo mode) — subconjunto representativo del plan real
// ------------------------------------------------------------------

const MOCK_ACCOUNTS: ChartAccount[] = [
  { id: "a-1103", code: "1.1.03", name: "Deudores por Ventas", type: "activo", subtype: "corriente", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-1105", code: "1.1.05", name: "IVA Crédito Fiscal", type: "activo", subtype: "corriente", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-2101", code: "2.1.01", name: "Proveedores", type: "pasivo", subtype: "corriente", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-2102", code: "2.1.02", name: "IVA Débito Fiscal", type: "pasivo", subtype: "corriente", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-4105", code: "4.1.05", name: "Ventas - Servicios Logísticos", type: "ingreso", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-4107", code: "4.1.07", name: "Ventas No Gravadas / Exentas", type: "ingreso", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-6104", code: "6.1.04", name: "Cargas Sociales", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-6105", code: "6.1.05", name: "Servicios Públicos", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-6108", code: "6.1.08", name: "Honorarios Profesionales", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-6109", code: "6.1.09", name: "Seguros", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-6110", code: "6.1.10", name: "Otros Gastos Operativos", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: true },
  { id: "a-6114", code: "6.1.14", name: "Alquileres", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: false },
  { id: "a-6115", code: "6.1.15", name: "Combustible", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: false },
  { id: "a-6117", code: "6.1.17", name: "Telefonía", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: false },
  { id: "a-6118", code: "6.1.18", name: "Internet", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: false },
  { id: "a-6124", code: "6.1.24", name: "Viáticos", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: false },
  { id: "a-6125", code: "6.1.25", name: "Publicidad", type: "gasto", subtype: "operativo", parent_id: null, is_postable: true, is_active: true, is_system: false },
];

const MOCK_RULES: AccountingRule[] = [
  { id: "r-1", source_type: "customer_invoice", rule_key: "revenue", account_code: "4.1.05", notes: "(*) Ventas — default servicios logísticos" },
  { id: "r-2", source_type: "supplier_invoice", rule_key: "expense", account_code: "6.1.10", notes: "(*) Gasto — default otros gastos operativos" },
];

// ------------------------------------------------------------------
// CHART OF ACCOUNTS
// ------------------------------------------------------------------

export interface ChartAccountFilters {
  /** Filtra por uno o varios tipos (ej. solo gasto/costo para imputación de compras). */
  types?: AccountType[];
  /** Solo cuentas imputables (hojas). Útil para selects de imputación. */
  postableOnly?: boolean;
  /** Solo cuentas activas. Por defecto true. */
  activeOnly?: boolean;
}

/**
 * Lista el Plan de Cuentas, ordenado por código. Pensada para alimentar
 * pickers de imputación y la vista de catálogo. Read-only (RLS).
 */
export async function listChartOfAccounts(
  filters: ChartAccountFilters = {}
): Promise<ChartAccount[]> {
  const { types, postableOnly = false, activeOnly = true } = filters;

  if (isMock()) return filterAccounts(MOCK_ACCOUNTS, filters);
  const supabase = createClient();
  if (!supabase) return filterAccounts(MOCK_ACCOUNTS, filters);

  let q = supabase.from("chart_of_accounts").select("*").order("code");
  if (activeOnly) q = q.eq("is_active", true);
  if (postableOnly) q = q.eq("is_postable", true);
  if (types && types.length) q = q.in("type", types);

  const { data, error } = await q;
  if (error) throw new Error(`listChartOfAccounts: ${error.message}`);
  return (data ?? []) as ChartAccount[];
}

/** Devuelve una cuenta por su código (ej. '6.1.10'), o null si no existe/activa. */
export async function getAccountByCode(code: string): Promise<ChartAccount | null> {
  if (!code) return null;
  if (isMock()) return MOCK_ACCOUNTS.find((a) => a.code === code) ?? null;
  const supabase = createClient();
  if (!supabase) return MOCK_ACCOUNTS.find((a) => a.code === code) ?? null;
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(`getAccountByCode: ${error.message}`);
  return (data as ChartAccount) ?? null;
}

/** Lista las reglas de imputación por defecto (accounting_rules). */
export async function listAccountingRules(): Promise<AccountingRule[]> {
  if (isMock()) return MOCK_RULES;
  const supabase = createClient();
  if (!supabase) return MOCK_RULES;
  const { data, error } = await supabase
    .from("accounting_rules")
    .select("id, source_type, rule_key, account_code, notes")
    .order("source_type")
    .order("rule_key");
  if (error) throw new Error(`listAccountingRules: ${error.message}`);
  return (data ?? []) as AccountingRule[];
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function filterAccounts(
  rows: ChartAccount[],
  { types, postableOnly = false, activeOnly = true }: ChartAccountFilters
): ChartAccount[] {
  return rows
    .filter((a) => (activeOnly ? a.is_active : true))
    .filter((a) => (postableOnly ? a.is_postable : true))
    .filter((a) => (types && types.length ? types.includes(a.type) : true))
    .sort((a, b) => a.code.localeCompare(b.code, "es"));
}
