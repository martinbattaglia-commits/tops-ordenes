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
  PercepcionVentaRow,
  RetencionPracticadaRow,
  PagoProveedorRetencionRow,
  PosicionFiscalRow,
  VendorOption,
  BankOption,
  SupplierOpenItemOption,
  CustomerInvoiceOption,
  CentroCostoRow,
  ResultadoCCRow,
  OrdenFacturableRow,
  OrdenFacturadaRow,
  PeriodoCierreRow,
  BillableServiceRow,
  TarifaRow,
  TarifaVencidaRow,
  BillingRunRow,
  BillingRunItemRow,
  OrdenPricingRow,
  ResultadoAnualRow,
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

// ----- Fase 10: percepciones de venta y retenciones practicadas -----

export async function getPercepcionesVentas(): Promise<PercepcionVentaRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_percepciones_ventas")
    .select("periodo, tax_type, jurisdiction, comprobantes, base_imponible, importe")
    .order("periodo", { ascending: false });
  if (error) throw new Error(`contabilidad.percepciones-ventas: ${error.message}`);
  return (data ?? []).map((r) => ({
    periodo: r.periodo as string,
    taxType: r.tax_type as string,
    jurisdiction: (r.jurisdiction as string) ?? "",
    comprobantes: n(r.comprobantes),
    baseImponible: n(r.base_imponible),
    importe: n(r.importe),
  }));
}

export async function getRetencionesPracticadas(): Promise<RetencionPracticadaRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_retenciones_practicadas")
    .select("periodo, withholding_type, jurisdiction, pagos, retenciones, base_imponible, importe")
    .order("periodo", { ascending: false });
  if (error) throw new Error(`contabilidad.retenciones-practicadas: ${error.message}`);
  return (data ?? []).map((r) => ({
    periodo: r.periodo as string,
    withholdingType: r.withholding_type as string,
    jurisdiction: (r.jurisdiction as string) ?? "",
    pagos: n(r.pagos),
    retenciones: n(r.retenciones),
    baseImponible: n(r.base_imponible),
    importe: n(r.importe),
  }));
}

export async function getPagosProveedorRetenciones(soloConRetencion = true): Promise<PagoProveedorRetencionRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  let q = supabase
    .from("v_pagos_proveedor_retenciones")
    .select("payment_id, public_id, proveedor, periodo, pago_bruto, retenciones, pago_neto")
    .order("periodo", { ascending: false })
    .limit(2000);
  if (soloConRetencion) q = q.gt("retenciones", 0);
  const { data, error } = await q;
  if (error) throw new Error(`contabilidad.pagos-retenciones: ${error.message}`);
  return (data ?? []).map((r) => ({
    paymentId: r.payment_id as string,
    publicId: (r.public_id as string | null) ?? null,
    proveedor: (r.proveedor as string | null) ?? null,
    periodo: r.periodo as string,
    pagoBruto: n(r.pago_bruto),
    retenciones: n(r.retenciones),
    pagoNeto: n(r.pago_neto),
  }));
}

export async function getPosicionFiscalMensual(): Promise<PosicionFiscalRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_posicion_fiscal_mensual")
    .select("*")
    .order("periodo", { ascending: false });
  if (error) throw new Error(`contabilidad.posicion-fiscal: ${error.message}`);
  return (data ?? []).map((r) => ({
    periodo: r.periodo as string,
    ivaSaldoPosicion: n(r.iva_saldo_posicion),
    ivaResultado: r.iva_resultado as string,
    percepcionesVentasADepositar: n(r.percepciones_ventas_a_depositar),
    retencionesPracticadasADepositar: n(r.retenciones_practicadas_a_depositar),
    percepcionesIvaSufridas: n(r.percepciones_iva_sufridas),
    retencionesSufridas: n(r.retenciones_sufridas),
  }));
}

// ----- Fase 11: opciones para formularios (alta de pago/percepciones) -----

export async function getVendores(): Promise<VendorOption[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("vendors")
    .select("id, razon, cuit")
    .eq("active", true)
    .order("razon", { ascending: true });
  if (error) throw new Error(`contabilidad.vendors: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id as string, razon: r.razon as string, cuit: (r.cuit as string) ?? "" }));
}

export async function getBankAccountsSimple(): Promise<BankOption[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("id, bank_name, account_name, is_system, active")
    .eq("active", true)
    .order("is_system", { ascending: false })
    .order("bank_name", { ascending: true });
  if (error) throw new Error(`contabilidad.bank-accounts: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: `${r.bank_name as string} · ${r.account_name as string}`,
    isSystem: Boolean(r.is_system),
  }));
}

export async function getSupplierOpenItems(): Promise<SupplierOpenItemOption[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("supplier_open_items")
    .select("invoice_id, vendor_id, public_id, total, saldo, estado_pago")
    .gt("saldo", 0)
    .order("public_id", { ascending: true });
  if (error) throw new Error(`contabilidad.supplier-open-items: ${error.message}`);
  return (data ?? []).map((r) => ({
    invoiceId: r.invoice_id as string,
    vendorId: r.vendor_id as string,
    publicId: r.public_id as string,
    total: n(r.total),
    saldo: n(r.saldo),
    estadoPago: r.estado_pago as string,
  }));
}

export async function getCustomerInvoicesParaPercepciones(): Promise<CustomerInvoiceOption[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("customer_invoices")
    .select("id, tipo_comprobante, punto_venta, numero_comprobante, razon_social, percepciones, tributos, estado_arca, anulada, created_at")
    .eq("estado_arca", "AUTORIZADO_ARCA")
    .eq("anulada", false)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`contabilidad.customer-invoices: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: `${r.tipo_comprobante as string} ${r.punto_venta as number}-${(r.numero_comprobante as number) ?? "—"} · ${r.razon_social as string}`,
    percepciones: n(r.percepciones),
    tributos: n(r.tributos),
  }));
}

// ----- Fase 12: centros de costo, logística facturable, cierre -----

export async function getCentrosCosto(): Promise<CentroCostoRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("cost_centers")
    .select("id, code, name, type, active")
    .order("type", { ascending: true })
    .order("code", { ascending: true });
  if (error) throw new Error(`contabilidad.centros-costo: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    type: (r.type as string | null) ?? null,
    active: Boolean(r.active),
  }));
}

export async function getResultadoPorCC(): Promise<ResultadoCCRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_resultado_por_cc")
    .select("periodo, centro_costo_code, centro_costo_nombre, tipo, ingresos, gastos, resultado, margen_pct")
    .order("periodo", { ascending: false })
    .order("resultado", { ascending: false });
  if (error) throw new Error(`contabilidad.resultado-cc: ${error.message}`);
  return (data ?? []).map((r) => ({
    periodo: r.periodo as string,
    centroCostoCode: r.centro_costo_code as string,
    centroCostoNombre: r.centro_costo_nombre as string,
    tipo: (r.tipo as string | null) ?? null,
    ingresos: n(r.ingresos),
    gastos: n(r.gastos),
    resultado: n(r.resultado),
    margenPct: r.margen_pct == null ? null : n(r.margen_pct),
  }));
}

export async function getOrdenesFacturables(): Promise<OrdenFacturableRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_logistics_orders_facturables")
    .select("order_id, public_id, client_name, customer_ref, status, fecha, billing_status, billable_amount")
    .order("fecha", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`contabilidad.ordenes-facturables: ${error.message}`);
  return (data ?? []).map((r) => ({
    orderId: r.order_id as string,
    publicId: r.public_id as string,
    clientName: r.client_name as string,
    customerRef: (r.customer_ref as string | null) ?? null,
    status: r.status as string,
    fecha: r.fecha as string,
    billingStatus: r.billing_status as string,
    billableAmount: r.billable_amount == null ? null : n(r.billable_amount),
  }));
}

export async function getOrdenesFacturadas(): Promise<OrdenFacturadaRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_logistics_orders_facturadas")
    .select("order_id, public_id, client_name, customer_invoice_id, factura_total, billing_period_start, billing_period_end")
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`contabilidad.ordenes-facturadas: ${error.message}`);
  return (data ?? []).map((r) => ({
    orderId: r.order_id as string,
    publicId: r.public_id as string,
    clientName: r.client_name as string,
    customerInvoiceId: (r.customer_invoice_id as string | null) ?? null,
    facturaTotal: r.factura_total == null ? null : n(r.factura_total),
    periodoStart: (r.billing_period_start as string | null) ?? null,
    periodoEnd: (r.billing_period_end as string | null) ?? null,
  }));
}

export async function getPeriodosParaCierre(): Promise<PeriodoCierreRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_periodos_para_cierre")
    .select("period_id, year, month, status, descuadrados, comprobantes_sin_asiento, iva_diffs, listo")
    .order("year", { ascending: false })
    .order("month", { ascending: false });
  if (error) throw new Error(`contabilidad.periodos-cierre: ${error.message}`);
  return (data ?? []).map((r) => ({
    periodId: r.period_id as string,
    year: n(r.year),
    month: n(r.month),
    status: r.status as string,
    descuadrados: n(r.descuadrados),
    comprobantesSinAsiento: n(r.comprobantes_sin_asiento),
    ivaDiffs: n(r.iva_diffs),
    listo: Boolean(r.listo),
  }));
}

// ----- Fase 13 -----

export async function getBillableServices(): Promise<BillableServiceRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("billable_services")
    .select("id, code, name, service_type, unit, default_vat_rate, is_active")
    .order("service_type", { ascending: true })
    .order("code", { ascending: true });
  if (error) throw new Error(`contabilidad.billable-services: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    serviceType: r.service_type as string,
    unit: r.unit as string,
    defaultVatRate: n(r.default_vat_rate),
    isActive: Boolean(r.is_active),
  }));
}

export async function getTarifasVigentes(): Promise<TarifaRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_tarifas_vigentes")
    .select("rate_id, cliente, servicio_code, servicio, currency, unit_price, vat_rate, billing_frequency, valid_from, valid_to")
    .order("cliente", { ascending: true });
  if (error) throw new Error(`contabilidad.tarifas-vigentes: ${error.message}`);
  return (data ?? []).map((r) => ({
    rateId: r.rate_id as string,
    cliente: r.cliente as string,
    servicioCode: r.servicio_code as string,
    servicio: r.servicio as string,
    currency: r.currency as string,
    unitPrice: n(r.unit_price),
    vatRate: n(r.vat_rate),
    billingFrequency: r.billing_frequency as string,
    validFrom: r.valid_from as string,
    validTo: (r.valid_to as string | null) ?? null,
  }));
}

export async function getTarifasVencidas(): Promise<TarifaVencidaRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_tarifas_vencidas")
    .select("rate_id, cliente, servicio_code, servicio, unit_price, valid_from, valid_to")
    .order("valid_to", { ascending: true });
  if (error) throw new Error(`contabilidad.tarifas-vencidas: ${error.message}`);
  return (data ?? []).map((r) => ({
    rateId: r.rate_id as string,
    cliente: r.cliente as string,
    servicioCode: r.servicio_code as string,
    servicio: r.servicio as string,
    unitPrice: n(r.unit_price),
    validFrom: r.valid_from as string,
    validTo: (r.valid_to as string | null) ?? null,
  }));
}

export async function getBillingRuns(): Promise<BillingRunRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_billing_runs")
    .select("billing_run_id, period_start, period_end, run_type, status, items, total_bruto")
    .order("period_start", { ascending: false });
  if (error) throw new Error(`contabilidad.billing-runs: ${error.message}`);
  return (data ?? []).map((r) => ({
    billingRunId: r.billing_run_id as string,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
    runType: r.run_type as string,
    status: r.status as string,
    items: n(r.items),
    totalBruto: n(r.total_bruto),
  }));
}

export async function getBillingRunItems(runId: string): Promise<BillingRunItemRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_billing_run_items")
    .select("item_id, billing_run_id, customer_id, cliente, servicio_code, servicio, quantity, unit_price, net_amount, vat_rate, vat_amount, gross_amount, status, customer_invoice_id")
    .eq("billing_run_id", runId)
    .order("cliente", { ascending: true });
  if (error) throw new Error(`contabilidad.billing-run-items: ${error.message}`);
  return (data ?? []).map((r) => ({
    itemId: r.item_id as string,
    billingRunId: r.billing_run_id as string,
    cliente: r.cliente as string,
    servicioCode: r.servicio_code as string,
    servicio: r.servicio as string,
    quantity: n(r.quantity),
    unitPrice: n(r.unit_price),
    netAmount: n(r.net_amount),
    vatRate: n(r.vat_rate),
    vatAmount: n(r.vat_amount),
    grossAmount: n(r.gross_amount),
    status: r.status as string,
    customerInvoiceId: (r.customer_invoice_id as string | null) ?? null,
    customerId: r.customer_id as string,
  }));
}

export async function getOrdenesPricing(): Promise<OrdenPricingRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_logistics_orders_pricing")
    .select("order_id, public_id, client_name, client_matches, items_count, priceable, motivo_no_priceable")
    .order("fecha", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`contabilidad.ordenes-pricing: ${error.message}`);
  return (data ?? []).map((r) => ({
    orderId: r.order_id as string,
    publicId: r.public_id as string,
    clientName: r.client_name as string,
    clientMatches: n(r.client_matches),
    itemsCount: n(r.items_count),
    priceable: Boolean(r.priceable),
    motivoNoPriceable: r.motivo_no_priceable as string,
  }));
}

export async function getResultadoAnual(): Promise<ResultadoAnualRow[]> {
  if (isUnavailable()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("v_resultado_anual")
    .select("ejercicio, ingresos, gastos, resultado_ejercicio")
    .order("ejercicio", { ascending: false });
  if (error) throw new Error(`contabilidad.resultado-anual: ${error.message}`);
  return (data ?? []).map((r) => ({
    ejercicio: n(r.ejercicio),
    ingresos: n(r.ingresos),
    gastos: n(r.gastos),
    resultadoEjercicio: n(r.resultado_ejercicio),
  }));
}
