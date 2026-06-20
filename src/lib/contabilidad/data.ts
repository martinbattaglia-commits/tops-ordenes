import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type {
  ChartAccount,
  PosicionIvaRow,
  DiarioRow,
  MayorRow,
  BalanceRow,
  ResultadoRow,
  ComprobanteSinAsiento,
  AccountType,
} from "./types";

/**
 * Capa de datos del módulo de Contabilidad (lectura).
 *
 * Fuente: vistas read-only 0086 (security_invoker → respetan RLS) + tabla
 * chart_of_accounts. El frontend NO recalcula contabilidad: los importes ya
 * vienen derivados por las vistas; acá solo se mapean y totalizan.
 *
 * En demo/sin Supabase, cada accessor devuelve vacío para degradar limpio.
 * Si la migración no está aplicada, la query lanza y la página muestra
 * <ModuleUnavailable migration="0083_accounting_core" />.
 */

function n(v: unknown): number {
  const x = Number(v);
  return isFinite(x) ? x : 0;
}
function isUnavailable(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

export async function getPlanCuentas(): Promise<ChartAccount[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("id, code, name, type, subtype, parent_id, is_postable, is_active, is_system")
    .order("code", { ascending: true });
  if (error) throw new Error(`contabilidad.plan-cuentas: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    type: r.type as AccountType,
    subtype: (r.subtype as string | null) ?? null,
    parentId: (r.parent_id as string | null) ?? null,
    isPostable: Boolean(r.is_postable),
    isActive: Boolean(r.is_active),
    isSystem: Boolean(r.is_system),
  }));
}

export async function getPosicionIva(): Promise<PosicionIvaRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_posicion_iva")
    .select("*")
    .order("periodo", { ascending: false });
  if (error) throw new Error(`contabilidad.posicion-iva: ${error.message}`);
  return (data ?? []).map((r) => ({
    periodo: r.periodo as string,
    ivaDebitoFiscal: n(r.iva_debito_fiscal),
    ivaCreditoFiscal: n(r.iva_credito_fiscal),
    saldoTecnico: n(r.saldo_tecnico),
    percepcionesIvaSufridas: n(r.percepciones_iva_sufridas),
    retencionesSufridas: n(r.retenciones_sufridas),
    saldoPosicion: n(r.saldo_posicion),
    resultado: r.resultado as PosicionIvaRow["resultado"],
  }));
}

export async function getLibroDiario(periodo?: string | null, limit = 2000): Promise<DiarioRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  let q = supabase
    .from("v_libro_diario")
    .select(
      "entry_id, entry_number, entry_date, periodo, source_type, asiento_descripcion, line_no, cuenta_codigo, cuenta_nombre, cuenta_tipo, linea_descripcion, debit, credit, centro_costo"
    )
    .order("entry_date", { ascending: true })
    .order("entry_number", { ascending: true })
    .order("line_no", { ascending: true })
    .limit(limit);
  if (periodo) q = q.eq("periodo", periodo);
  const { data, error } = await q;
  if (error) throw new Error(`contabilidad.libro-diario: ${error.message}`);
  return (data ?? []).map((r) => ({
    entryId: r.entry_id as string,
    entryNumber: (r.entry_number as number | null) ?? null,
    entryDate: r.entry_date as string,
    periodo: r.periodo as string,
    sourceType: r.source_type as string,
    asientoDescripcion: (r.asiento_descripcion as string | null) ?? null,
    lineNo: n(r.line_no),
    cuentaCodigo: r.cuenta_codigo as string,
    cuentaNombre: r.cuenta_nombre as string,
    cuentaTipo: r.cuenta_tipo as AccountType,
    lineaDescripcion: (r.linea_descripcion as string | null) ?? null,
    debit: n(r.debit),
    credit: n(r.credit),
    centroCosto: (r.centro_costo as string | null) ?? null,
  }));
}

export async function getMayor(accountCode?: string | null, periodo?: string | null, limit = 5000): Promise<MayorRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  let q = supabase
    .from("v_libro_mayor")
    .select(
      "account_id, cuenta_codigo, cuenta_nombre, cuenta_tipo, entry_number, entry_date, periodo, linea_descripcion, debit, credit, saldo_acumulado"
    )
    .order("cuenta_codigo", { ascending: true })
    .order("entry_date", { ascending: true })
    .order("entry_number", { ascending: true })
    .limit(limit);
  if (accountCode) q = q.eq("cuenta_codigo", accountCode);
  if (periodo) q = q.eq("periodo", periodo);
  const { data, error } = await q;
  if (error) throw new Error(`contabilidad.mayor: ${error.message}`);
  return (data ?? []).map((r) => ({
    accountId: r.account_id as string,
    cuentaCodigo: r.cuenta_codigo as string,
    cuentaNombre: r.cuenta_nombre as string,
    cuentaTipo: r.cuenta_tipo as AccountType,
    entryNumber: (r.entry_number as number | null) ?? null,
    entryDate: r.entry_date as string,
    periodo: r.periodo as string,
    lineaDescripcion: (r.linea_descripcion as string | null) ?? null,
    debit: n(r.debit),
    credit: n(r.credit),
    saldoAcumulado: n(r.saldo_acumulado),
  }));
}

export async function getBalanceSumasSaldos(): Promise<BalanceRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_balance_sumas_saldos")
    .select("account_id, cuenta_codigo, cuenta_nombre, cuenta_tipo, total_debe, total_haber, saldo_deudor, saldo_acreedor")
    .order("cuenta_codigo", { ascending: true });
  if (error) throw new Error(`contabilidad.balance: ${error.message}`);
  return (data ?? []).map((r) => ({
    accountId: r.account_id as string,
    cuentaCodigo: r.cuenta_codigo as string,
    cuentaNombre: r.cuenta_nombre as string,
    cuentaTipo: r.cuenta_tipo as AccountType,
    totalDebe: n(r.total_debe),
    totalHaber: n(r.total_haber),
    saldoDeudor: n(r.saldo_deudor),
    saldoAcreedor: n(r.saldo_acreedor),
  }));
}

export async function getEstadoResultados(periodo?: string | null): Promise<ResultadoRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  let q = supabase
    .from("v_estado_resultados")
    .select("periodo, cuenta_tipo, cuenta_codigo, cuenta_nombre, debe, haber, neto")
    .order("cuenta_codigo", { ascending: true });
  if (periodo) q = q.eq("periodo", periodo);
  const { data, error } = await q;
  if (error) throw new Error(`contabilidad.estado-resultados: ${error.message}`);
  return (data ?? []).map((r) => ({
    periodo: r.periodo as string,
    cuentaTipo: r.cuenta_tipo as AccountType,
    cuentaCodigo: r.cuenta_codigo as string,
    cuentaNombre: r.cuenta_nombre as string,
    debe: n(r.debe),
    haber: n(r.haber),
    neto: n(r.neto),
  }));
}

export async function getComprobantesSinAsiento(): Promise<ComprobanteSinAsiento[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_comprobantes_sin_asiento")
    .select("source_type, source_id, fecha, referencia, entidad, importe")
    .order("fecha", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`contabilidad.comprobantes-sin-asiento: ${error.message}`);
  return (data ?? []).map((r) => ({
    sourceType: r.source_type as string,
    sourceId: r.source_id as string,
    fecha: r.fecha as string,
    referencia: (r.referencia as string | null) ?? null,
    entidad: (r.entidad as string | null) ?? null,
    importe: n(r.importe),
  }));
}
