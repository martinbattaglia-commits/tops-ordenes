/**
 * Capa de Acceso a Datos Canónica para el Módulo de Finanzas.
 *
 * Principio Rector: Finanzas versiona supuestos y lee hechos de Tesorería.
 * Jamás muta ni reescribe movimientos inmutables de Tesorería.
 *
 * Semántica Canónica de Signos:
 * ENTRA DINERO = POSITIVO (+) = VERDE
 * SALE DINERO = NEGATIVO (-) = ROJO
 */

import { createClient } from "@/lib/supabase/server";
import type {
  FinanceVersion,
  FinanceCategory,
  FinanceCostCenter,
  FinanceDocumentInboxItem,
  FinanceUnifiedTransaction,
  FinanceForecastAdjustment,
  FinanceForecastReconciliation,
  FinanceMovementReconciliationItem,
  AccountGroupPosition,
  FinanceCurrency,
  FinanceAccountGroup,
  FinanceDirection,
} from "./types";
import type {
  TreasuryMovement,
  CustomerOpenItem,
  SupplierOpenItem,
} from "@/lib/tesoreria/types";
import {
  listBankAccounts,
  getBankBalances,
  listMovements,
  listCustomerOpenItems,
  listSupplierOpenItems,
} from "@/lib/tesoreria/data";

/**
 * Obtiene la versión activa de presupuesto.
 */
export async function getActiveFinanceVersion(): Promise<FinanceVersion | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("finance_versions")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      id: "v-default-2026",
      code: "BUDGET-2026-V1",
      name: "Presupuesto Operativo 2026 v1.0",
      description: "Presupuesto anual base 2026",
      status: "approved",
      valid_from: "2026-01-01",
      valid_to: "2026-12-31",
      parent_version_id: null,
      is_active: true,
      approved_at: "2026-01-01T00:00:00Z",
      approved_by: null,
      created_by: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }
  return data as FinanceVersion | null;
}

/**
 * Lista todas las versiones de presupuesto disponibles.
 */
export async function listFinanceVersions(): Promise<FinanceVersion[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("finance_versions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    const active = await getActiveFinanceVersion();
    return active ? [active] : [];
  }
  return (data ?? []) as FinanceVersion[];
}

/**
 * Obtiene el catálogo de categorías analíticas de ingresos y egresos.
 */
export async function listFinanceCategories(): Promise<FinanceCategory[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("finance_categories")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) {
    return [
      { id: "1", parent_id: null, code: "ING_FLETES", name: "Ingresos por Fletes y Servicios Generales", category_type: "ingreso", display_order: 10, is_active: true, created_at: "2026-01-01" },
      { id: "2", parent_id: null, code: "ING_LOG_DISTRIB", name: "Ingresos Logística y Distribución Urbana", category_type: "ingreso", display_order: 20, is_active: true, created_at: "2026-01-01" },
      { id: "3", parent_id: null, code: "ING_LOG_FARMACIA", name: "Ingresos Logística Farmacéutica ANMAT", category_type: "ingreso", display_order: 30, is_active: true, created_at: "2026-01-01" },
      { id: "4", parent_id: null, code: "EGR_SUELDOS", name: "Sueldos y Cargas Sociales", category_type: "egreso", display_order: 100, is_active: true, created_at: "2026-01-01" },
      { id: "5", parent_id: null, code: "EGR_COMBUSTIBLE", name: "Combustible y Peajes", category_type: "egreso", display_order: 110, is_active: true, created_at: "2026-01-01" },
      { id: "6", parent_id: null, code: "EGR_MANTENIMIENTO", name: "Mantenimiento de Flota y Edilicio", category_type: "egreso", display_order: 120, is_active: true, created_at: "2026-01-01" },
      { id: "7", parent_id: null, code: "EGR_SEGUROS", name: "Seguros y Pólizas de Carga", category_type: "egreso", display_order: 130, is_active: true, created_at: "2026-01-01" },
      { id: "8", parent_id: null, code: "EGR_ALQUILERES", name: "Alquileres de Depósitos", category_type: "egreso", display_order: 140, is_active: true, created_at: "2026-01-01" },
    ];
  }
  return (data ?? []) as FinanceCategory[];
}

/**
 * Obtiene los centros de costo.
 */
export async function listFinanceCostCenters(): Promise<FinanceCostCenter[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("finance_cost_centers")
    .select("*")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error) {
    return [
      { id: "1", code: "CC_CARGAS_GEN", name: "Operaciones Cargas Generales", business_line: "cargas_generales", is_active: true, created_at: "2026-01-01" },
      { id: "2", code: "CC_ANMAT", name: "Operaciones Reguladas ANMAT", business_line: "anmat", is_active: true, created_at: "2026-01-01" },
      { id: "3", code: "CC_DEPOSITO", name: "Depósito y Almacenamiento", business_line: "almacenamiento", is_active: true, created_at: "2026-01-01" },
      { id: "4", code: "CC_DISTRIB", name: "Distribución Urbana y Flota", business_line: "distribucion", is_active: true, created_at: "2026-01-01" },
      { id: "5", code: "CC_ADMIN_CORP", name: "Administración y Corporativo", business_line: "corporativo", is_active: true, created_at: "2026-01-01" },
    ];
  }
  return (data ?? []) as FinanceCostCenter[];
}

/**
 * Obtiene las previsiones financieras almacenadas en la base de datos.
 */
export async function listFinanceForecastAdjustments(opts?: {
  status?: string[];
  currency?: FinanceCurrency;
  startDate?: string;
  endDate?: string;
}): Promise<FinanceForecastAdjustment[]> {
  const supabase = createClient();
  if (!supabase) return [];
  let qb = supabase.from("finance_forecast_adjustments").select("*");

  if (opts?.status && opts.status.length > 0) {
    qb = qb.in("status", opts.status);
  }
  if (opts?.currency) {
    qb = qb.eq("currency", opts.currency);
  }
  if (opts?.startDate) {
    qb = qb.gte("date", opts.startDate);
  }
  if (opts?.endDate) {
    qb = qb.lte("date", opts.endDate);
  }

  const { data, error } = await qb.order("date", { ascending: true });
  if (error) return [];
  return (data ?? []) as FinanceForecastAdjustment[];
}

/**
 * Obtiene las previsiones compatibles para asociar desde Tesorería.
 */
export async function listCompatibleForecastAdjustments(params?: {
  direction?: FinanceDirection;
  currency?: FinanceCurrency;
  counterpart?: string | null;
}): Promise<FinanceForecastAdjustment[]> {
  const supabase = createClient();
  if (!supabase) return [];
  let qb = supabase
    .from("finance_forecast_adjustments")
    .select("*")
    .in("status", ["proyectado", "comprometido"]);

  if (params?.direction) {
    qb = qb.eq("direction", params.direction);
  }
  if (params?.currency) {
    qb = qb.eq("currency", params.currency);
  }

  const { data, error } = await qb.order("date", { ascending: true });
  if (error) return [];
  return (data ?? []) as FinanceForecastAdjustment[];
}

/**
 * Agrupa las cuentas en los 4 agrupadores obligatorios (Bancos, Caja, Ahorros, Tarjetas).
 */
export async function getConsolidatedAccountPositions(): Promise<AccountGroupPosition[]> {
  const [bankAccounts, bankBalances] = await Promise.all([
    listBankAccounts().catch(() => []),
    getBankBalances().catch(() => []),
  ]);

  const balanceMap = new Map(bankBalances.map((b) => [b.bank_account_id, Number(b.balance || 0)]));

  const groups: Record<"bancos" | "caja" | "ahorros" | "tarjetas", AccountGroupPosition> = {
    bancos: { group: "bancos", label: "Bancos", arsBalance: 0, usdBalance: 0, accounts: [] },
    caja: { group: "caja", label: "Caja", arsBalance: 0, usdBalance: 0, accounts: [] },
    ahorros: { group: "ahorros", label: "Ahorros / Inversiones", arsBalance: 0, usdBalance: 0, accounts: [] },
    tarjetas: { group: "tarjetas", label: "Tarjetas Corporativas", arsBalance: 0, usdBalance: 0, accounts: [] },
  };

  for (const acc of bankAccounts) {
    const balance = balanceMap.get(acc.id) ?? Number(acc.opening_balance || 0);
    const curr = (acc.currency === "USD" ? "USD" : "ARS") as FinanceCurrency;

    let targetGroup: "bancos" | "caja" | "ahorros" | "tarjetas" = "bancos";
    if (acc.account_type === "caja") {
      targetGroup = "caja";
    } else if (acc.account_type === "ahorros" || acc.account_name.toLowerCase().includes("inversion")) {
      targetGroup = "ahorros";
    } else if (acc.account_type === "tarjeta" || acc.account_name.toLowerCase().includes("tarjeta")) {
      targetGroup = "tarjetas";
    }

    if (curr === "ARS") {
      groups[targetGroup].arsBalance += balance;
    } else {
      groups[targetGroup].usdBalance += balance;
    }

    groups[targetGroup].accounts.push({
      id: acc.id,
      name: acc.account_name,
      bankName: acc.bank_name,
      currency: curr,
      balance,
      type: acc.account_type,
    });
  }

  return Object.values(groups);
}

/**
 * Obtiene el historial de reconciliaciones financieras N:M (auditoría auditable).
 */
export async function listFinanceForecastReconciliations(opts?: {
  forecastId?: string;
  movementId?: string;
}): Promise<FinanceForecastReconciliation[]> {
  const supabase = createClient();
  if (!supabase) return [];
  let qb = supabase.from("finance_forecast_reconciliations").select("*");
  if (opts?.forecastId) qb = qb.eq("forecast_adjustment_id", opts.forecastId);
  if (opts?.movementId) qb = qb.eq("treasury_movement_id", opts.movementId);
  const { data, error } = await qb.order("reconciled_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as FinanceForecastReconciliation[];
}

export interface BuildUnifiedTransactionsParams {
  bankAccounts?: Array<{ id: string; account_name?: string; currency?: string; account_type?: string }>;
  realMovements?: TreasuryMovement[];
  customerItems?: CustomerOpenItem[];
  supplierItems?: SupplierOpenItem[];
  forecastAdjustments?: FinanceForecastAdjustment[];
  forecastReconciliations?: FinanceForecastReconciliation[];
}

/**
 * Función pura de mapeo unificado que integra hechos reales de Tesorería con previsiones
 * y cuentas por cobrar/pagar, preservando trazabilidad N:M completa y remanentes netos.
 */
export function buildUnifiedTransactions(params: BuildUnifiedTransactionsParams): FinanceUnifiedTransaction[] {
  const bankAccounts = params.bankAccounts ?? [];
  const realMovements = params.realMovements ?? [];
  const customerItems = params.customerItems ?? [];
  const supplierItems = params.supplierItems ?? [];
  const forecastAdjustments = params.forecastAdjustments ?? [];
  const forecastReconciliations = params.forecastReconciliations ?? [];

  const accountMap = new Map(bankAccounts.map((a) => [a.id, a]));
  const forecastMap = new Map(forecastAdjustments.map((f) => [f.id, f]));
  const transactions: FinanceUnifiedTransaction[] = [];

  // Mapeo N:M de reconciliaciones por movimiento
  const reconciliationsByMovement = new Map<string, FinanceForecastReconciliation[]>();
  // Mapeo N:M de reconciliaciones por previsión
  const reconciliationsByForecast = new Map<string, FinanceForecastReconciliation[]>();

  for (const r of forecastReconciliations) {
    const mList = reconciliationsByMovement.get(r.treasury_movement_id) ?? [];
    mList.push(r);
    reconciliationsByMovement.set(r.treasury_movement_id, mList);

    const fList = reconciliationsByForecast.get(r.forecast_adjustment_id) ?? [];
    fList.push(r);
    reconciliationsByForecast.set(r.forecast_adjustment_id, fList);
  }

  // 1. Hechos reales de Tesorería
  for (const m of realMovements) {
    const acc = accountMap.get(m.bank_account_id);
    const curr: FinanceCurrency = acc?.currency === "USD" ? "USD" : "ARS";

    let dir: FinanceDirection = m.direction === "ingreso" ? "ingreso" : "egreso";
    if (m.type === "transferencia") {
      dir = "transferencia";
    }

    let accountGroup: FinanceAccountGroup = "bancos";
    if (acc?.account_type === "caja") accountGroup = "caja";
    else if (acc?.account_type === "tarjeta") accountGroup = "tarjetas";
    else if (acc?.account_type === "ahorros") accountGroup = "ahorros";

    // Trazabilidad N:M completa de todas las reconciliaciones del movimiento
    const movRecons = reconciliationsByMovement.get(m.id) ?? [];
    const reconciliationItems: FinanceMovementReconciliationItem[] = [];
    let desvio: FinanceUnifiedTransaction["desvio"] | undefined;
    let counterpart: string | null = null;

    if (movRecons.length > 0) {
      let totalApplied = 0;
      let totalEstimated = 0;
      const counterparts: string[] = [];

      for (const r of movRecons) {
        const fc = forecastMap.get(r.forecast_adjustment_id);
        const appliedAmt = Number(r.applied_amount);
        const estAmt = fc ? Number(fc.amount) : appliedAmt;
        const estDateStr = fc?.date || m.date;
        const realDate = new Date(m.date);
        const estDate = new Date(estDateStr);
        const diffDays = Math.round((realDate.getTime() - estDate.getTime()) / (1000 * 60 * 60 * 24));

        totalApplied += appliedAmt;
        totalEstimated += estAmt;
        if (fc?.counterpart && !counterparts.includes(fc.counterpart)) {
          counterparts.push(fc.counterpart);
        }

        reconciliationItems.push({
          forecastId: r.forecast_adjustment_id,
          forecastConcept: fc?.concept || "Previsión vinculada",
          forecastCounterpart: fc?.counterpart || null,
          appliedAmount: appliedAmt,
          forecastAmount: estAmt,
          estimatedDate: estDateStr,
          varianceAmount: appliedAmt - estAmt,
          varianceDays: diffDays,
        });
      }

      counterpart = counterparts.join(", ") || null;

      const primaryFc = forecastMap.get(movRecons[0].forecast_adjustment_id);
      const primaryEstDate = primaryFc?.date || m.date;
      const primaryDiffDays = Math.round((new Date(m.date).getTime() - new Date(primaryEstDate).getTime()) / (1000 * 60 * 60 * 24));

      desvio = {
        estimatedDate: primaryEstDate,
        estimatedAmount: totalEstimated,
        varianceAmount: Number(m.amount) - totalEstimated,
        varianceDays: primaryDiffDays,
        totalAppliedAmount: totalApplied,
        reconciledForecastsCount: movRecons.length,
      };
    } else if (m.id) {
      // Fallback por matched_movement_id legacy si existiese
      const legacyMatched = forecastAdjustments.find((f) => f.matched_movement_id === m.id);
      if (legacyMatched) {
        counterpart = legacyMatched.counterpart || null;
        const realAmount = Number(m.amount);
        const estAmount = Number(legacyMatched.amount);
        const realDate = new Date(m.date);
        const estDate = new Date(legacyMatched.date);
        const diffDays = Math.round((realDate.getTime() - estDate.getTime()) / (1000 * 60 * 60 * 24));

        reconciliationItems.push({
          forecastId: legacyMatched.id,
          forecastConcept: legacyMatched.concept,
          forecastCounterpart: legacyMatched.counterpart || null,
          appliedAmount: realAmount,
          forecastAmount: estAmount,
          estimatedDate: legacyMatched.date,
          varianceAmount: realAmount - estAmount,
          varianceDays: diffDays,
        });

        desvio = {
          estimatedDate: legacyMatched.date,
          estimatedAmount: estAmount,
          varianceAmount: realAmount - estAmount,
          varianceDays: diffDays,
          totalAppliedAmount: realAmount,
          reconciledForecastsCount: 1,
        };
      }
    }

    transactions.push({
      id: m.id,
      date: m.date,
      direction: dir,
      concept: m.description || m.type,
      counterpart,
      amount: Number(m.amount),
      currency: curr,
      accountGroup,
      accountName: acc?.account_name || (accountGroup === "caja" ? "Caja Central" : "Cuenta Bancaria"),
      categoryName: m.operational_category || (m.type === "cobranza" ? "Cobranzas Clientes" : m.type === "pago_proveedor" ? "Pagos Proveedores" : "Operativo General"),
      isReal: true,
      status: "ejecutado",
      reconciliations: reconciliationItems.length > 0 ? reconciliationItems : undefined,
      desvio,
    });
  }

  // 2. Previsiones Financieras Abiertas / Programadas (Remanentes no reconciliados)
  for (const f of forecastAdjustments) {
    if (f.status === "anulado" || f.status === "reconciliado") {
      continue;
    }

    const totalAmount = Number(f.amount) || 0;
    const fRecons = reconciliationsByForecast.get(f.id) ?? [];
    const reconciledAmount = fRecons.length > 0
      ? fRecons.reduce((acc, r) => acc + Number(r.applied_amount), 0)
      : Number(f.reconciled_amount) || 0;

    const remainingAmount = Math.max(0, totalAmount - reconciledAmount);

    if (remainingAmount <= 0) {
      continue;
    }

    const curr: FinanceCurrency = f.currency || "ARS";
    const dir: FinanceDirection = f.direction || "egreso";

    if (!f.is_recurring) {
      transactions.push({
        id: `forecast-${f.id}`,
        date: f.date,
        direction: dir,
        concept: f.status === "comprometido" || reconciledAmount > 0 ? `${f.concept} (Saldo Remanente)` : f.concept,
        counterpart: f.counterpart || null,
        amount: remainingAmount,
        currency: curr,
        accountGroup: f.account_group || "bancos",
        accountName: f.account_group === "caja" ? "Caja" : "Banco Galicia / Santander",
        categoryName: "Previsión Financiera",
        isReal: false,
        status: f.status === "comprometido" || reconciledAmount > 0 ? "comprometido" : "proyectado",
        certainty: f.certainty_level || "alta",
      });
    } else {
      const baseDate = new Date(f.date);
      const baseDay = baseDate.getUTCDate();
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth();

      for (let offset = 0; offset < 12; offset++) {
        const occMonth = (currentMonth + offset) % 12;
        const occYear = currentYear + Math.floor((currentMonth + offset) / 12);
        const daysInOccMonth = new Date(occYear, occMonth + 1, 0).getDate();
        const clampedDay = Math.min(baseDay, daysInOccMonth);
        const occDateStr = `${occYear}-${String(occMonth + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;

        transactions.push({
          id: `forecast-rec-${f.id}-${occDateStr}`,
          date: occDateStr,
          direction: dir,
          concept: `${f.concept} (Recurrente)`,
          counterpart: f.counterpart || null,
          amount: remainingAmount,
          currency: curr,
          accountGroup: f.account_group || "bancos",
          accountName: f.account_group === "caja" ? "Caja" : "Banco Galicia / Santander",
          categoryName: "Previsión Recurrente",
          isReal: false,
          status: "proyectado",
          certainty: f.certainty_level || "alta",
        });
      }
    }
  }

  // 3. Cuentas por Cobrar Proyectadas
  for (const c of customerItems) {
    if (c.fch_vto_pago && Number(c.saldo) > 0) {
      transactions.push({
        id: `c-proj-${c.invoice_id}`,
        date: c.fch_vto_pago,
        direction: "ingreso",
        concept: `Cobranza Factura ${c.numero_comprobante || c.invoice_id.slice(0, 8)}`,
        counterpart: "Cliente",
        amount: Number(c.saldo),
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia / Santander",
        categoryName: "Ingresos por Fletes y Servicios",
        isReal: false,
        status: "proyectado",
        certainty: "media",
      });
    }
  }

  // 4. Cuentas por Pagar Proyectadas
  for (const s of supplierItems) {
    if (s.fecha_vencimiento && Number(s.saldo) > 0) {
      transactions.push({
        id: `s-proj-${s.invoice_id}`,
        date: s.fecha_vencimiento,
        direction: "egreso",
        concept: `Pago Factura Proveedor ${s.public_id || s.invoice_id.slice(0, 8)}`,
        counterpart: "Proveedor",
        amount: Number(s.saldo),
        currency: "ARS",
        accountGroup: "bancos",
        accountName: "Banco Galicia / Santander",
        categoryName: "Costos Operativos y Proveedores",
        isReal: false,
        status: "proyectado",
        certainty: "media",
      });
    }
  }

  // Ordenar cronológicamente ascendente (fecha, hechos reales primero)
  return transactions.sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    if (cmp !== 0) return cmp;
    if (a.isReal !== b.isReal) return a.isReal ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Obtiene la lista unificada de transacciones (hechos reales de Tesorería + previsiones reconciliadas y abiertas de Finanzas).
 */
export async function getUnifiedFinanceTransactions(opts?: {
  currency?: FinanceCurrency;
  limit?: number;
}): Promise<FinanceUnifiedTransaction[]> {
  const [bankAccounts, realMovements, customerItems, supplierItems, forecastAdjustments, forecastReconciliations] = await Promise.all([
    listBankAccounts().catch(() => []),
    listMovements({ limit: opts?.limit ?? 300 }).catch(() => []),
    listCustomerOpenItems().catch(() => []),
    listSupplierOpenItems().catch(() => []),
    listFinanceForecastAdjustments().catch(() => []),
    listFinanceForecastReconciliations().catch(() => []),
  ]);

  const all = buildUnifiedTransactions({
    bankAccounts,
    realMovements,
    customerItems,
    supplierItems,
    forecastAdjustments,
    forecastReconciliations,
  });

  if (opts?.currency) {
    return all.filter((t) => t.currency === opts.currency);
  }
  return all;
}

/**
 * Obtiene la bandeja de ingesta documental.
 */
export async function listDocumentInbox(): Promise<FinanceDocumentInboxItem[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("finance_document_inbox")
    .select("*")
    .order("received_at", { ascending: false });

  if (error) {
    return [];
  }
  return (data ?? []) as FinanceDocumentInboxItem[];
}
