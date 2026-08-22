/**
 * Tipos de dominio para el módulo nativo NEXUS Finanzas.
 *
 * Principio Rector: Finanzas versiona supuestos y lee hechos de Tesorería.
 * Jamás muta un hecho inmutable de Tesorería.
 */

export type FinanceVersionStatus = 'draft' | 'in_review' | 'approved' | 'closed';
export type FinanceDirection = 'ingreso' | 'egreso' | 'transferencia';
export type FinanceAccountGroup = 'bancos' | 'caja' | 'ahorros' | 'tarjetas';
export type FinanceCertaintyLevel = 'alta' | 'media' | 'baja';
export type FinanceForecastStatus = 'proyectado' | 'comprometido' | 'reconciliado' | 'anulado';
export type FinanceCurrency = 'ARS' | 'USD';
export type BusinessLine = 'cargas_generales' | 'anmat' | 'corporativo' | 'almacenamiento' | 'distribucion';

export interface FinanceVersion {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: FinanceVersionStatus;
  valid_from: string;
  valid_to: string;
  parent_version_id: string | null;
  is_active: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceAssumption {
  id: string;
  version_id: string;
  driver_key: string;
  name: string;
  category: string;
  unit: string;
  source: string | null;
  value: number;
  period: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceCategory {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  category_type: 'ingreso' | 'egreso' | 'activo' | 'pasivo';
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export interface FinanceCostCenter {
  id: string;
  code: string;
  name: string;
  business_line: BusinessLine;
  is_active: boolean;
  created_at: string;
}

export interface FinancePlanLine {
  id: string;
  version_id: string;
  category_id: string;
  cost_center_id: string | null;
  period: string; // YYYY-MM
  amount: number;
  currency: FinanceCurrency;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceForecastAdjustment {
  id: string;
  date: string;
  due_date: string | null;
  direction: FinanceDirection;
  amount: number;
  reconciled_amount?: number;
  currency: FinanceCurrency;
  account_group: FinanceAccountGroup;
  bank_account_id: string | null;
  counterpart: string | null;
  concept: string;
  category_id: string | null;
  cost_center_id: string | null;
  status: FinanceForecastStatus;
  certainty_level: FinanceCertaintyLevel;
  is_recurring: boolean;
  recurrence_rule: string | null;
  notes: string | null;
  evidence_url: string | null;
  matched_movement_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceForecastReconciliation {
  id: string;
  forecast_adjustment_id: string;
  treasury_movement_id: string;
  applied_amount: number;
  reconciled_at: string;
  reconciled_by: string | null;
  created_at: string;
}

export interface FinanceScenario {
  id: string;
  version_id: string;
  name: string;
  description: string | null;
  base_scenario_id: string | null;
  fx_rate_override: number | null;
  inflation_override: number | null;
  volume_factor: number;
  is_active: boolean;
  created_at: string;
}

export interface FinanceReportSnapshot {
  id: string;
  period: string;
  report_type: string;
  title: string;
  data: Record<string, unknown>;
  version_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface FinanceDocumentInboxItem {
  id: string;
  sender: string;
  subject: string;
  received_at: string;
  status: 'borrador' | 'en_revision' | 'procesado' | 'descartado';
  extracted_data: {
    monto?: number;
    moneda?: FinanceCurrency;
    cuit?: string;
    proveedor?: string;
    comprobante?: string;
    fecha_emision?: string;
    fecha_vencimiento?: string;
    concepto?: string;
    categoria_sugerida?: string;
    subtotal_neto?: number;
    iva_monto?: number;
    centro_costo_sugerido?: string;
  };
  raw_email_url: string | null;
  attachment_url: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceQuickenImport {
  id: string;
  filename: string;
  file_hash: string;
  total_records: number;
  total_amount_ars: number;
  total_amount_usd: number;
  status: 'preview' | 'validated' | 'imported' | 'failed';
  summary: {
    categories_found?: number;
    categories_mapped?: number;
    accounts_found?: number;
    duplicate_count?: number;
    date_range?: { min: string; max: string };
    discrepancies?: string[];
  };
  created_by: string | null;
  created_at: string;
}

/** Vínculo de reconciliación individual para un movimiento de Tesorería (N:M) */
export interface FinanceMovementReconciliationItem {
  forecastId: string;
  forecastConcept: string;
  forecastCounterpart: string | null;
  appliedAmount: number;
  forecastAmount: number;
  estimatedDate: string;
  varianceAmount: number; // appliedAmount - forecastAmount
  varianceDays: number;   // realDate - estimatedDate
}

/** Modelo unificado para la grilla y vistas de Caja y Liquidez */
export interface FinanceUnifiedTransaction {
  id: string;
  date: string;
  time?: string;
  createdAt?: string;
  direction: FinanceDirection;
  concept: string;
  counterpart: string | null;
  amount: number;
  currency: FinanceCurrency;
  accountGroup: FinanceAccountGroup;
  accountName: string;
  categoryName: string;
  costCenterName?: string;
  isReal: boolean; // true: Hecho de Tesorería, false: Supuesto/Proyección de Finanzas
  status: 'ejecutado' | 'conciliado' | 'proyectado' | 'comprometido' | 'vencida';
  certainty?: FinanceCertaintyLevel;
  evidenceUrl?: string | null;
  invoiceId?: string | null;
  numeroComprobante?: number | null;
  reconciliations?: FinanceMovementReconciliationItem[];
  desvio?: {
    estimatedDate?: string;
    estimatedAmount?: number;
    varianceAmount?: number;
    varianceDays?: number;
    totalAppliedAmount?: number;
    reconciledForecastsCount?: number;
  };
}

/** Estructura de Posición Consolidada por Agrupador */
export interface AccountGroupPosition {
  group: FinanceAccountGroup;
  label: string;
  arsBalance: number;
  usdBalance: number;
  accounts: {
    id: string;
    name: string;
    bankName: string;
    currency: FinanceCurrency;
    balance: number;
    type: string;
  }[];
}

/** Modelo para el saldo acumulado diario en el calendario */
export interface DailyCalendarBalance {
  day: number;
  date: string;
  inflows: number;
  outflows: number;
  netFlow: number;
  projectedClosingBalance: number;
  hasMovements: boolean;
  transactions: FinanceUnifiedTransaction[];
}

/** Estructura de Flujo de Fondos Proyectado de 13 Semanas */
export interface WeeklyCashflowItem {
  weekNumber: number;
  weekLabel: string;
  startDate: string;
  endDate: string;
  initialBalanceArs: number;
  inflowsArs: number;
  outflowsArs: number;
  netFlowArs: number;
  finalBalanceArs: number;
  initialBalanceUsd: number;
  inflowsUsd: number;
  outflowsUsd: number;
  netFlowUsd: number;
  finalBalanceUsd: number;
}

/** Métricas avanzadas para el Dashboard Ejecutivo de Finanzas */
export interface FinanceDashboardMetrics {
  expensesByCategory: {
    code: string;
    name: string;
    amount: number;
    percentage: number;
    color: string;
  }[];
  topPayees: {
    payee: string;
    amount: number;
    sharePercentage: number;
    txCount: number;
  }[];
  monthlyComparison: {
    period: string; // YYYY-MM
    label: string;
    income: number;
    expense: number;
    net: number;
  }[];
  budgetVsReal: {
    budgetedIncome: number;
    actualIncome: number;
    incomeVariance: number;
    budgetedExpense: number;
    actualExpense: number;
    expenseVariance: number;
    netSurplus: number;
    hasBudgetConfigured: boolean;
  };
  liquidityEvolution: {
    date: string;
    label: string;
    balance: number;
    projected: boolean;
  }[];
  upcomingMaturities: {
    days7: { payables: number; receivables: number; net: number };
    days15: { payables: number; receivables: number; net: number };
    days30: { payables: number; receivables: number; net: number };
  };
}

/** P&L Gerencial */
export interface ProfitAndLossStatement {
  period: string; // YYYY-MM
  currency: FinanceCurrency;
  ingresos: {
    total: number;
    byCategory: { code: string; name: string; amount: number; budgetAmount: number; variance: number }[];
  };
  costosDirectos: {
    total: number;
    byCategory: { code: string; name: string; amount: number; budgetAmount: number; variance: number }[];
  };
  margenBruto: number;
  margenBrutoPorcentaje: number;
  gastosOperativos: {
    total: number;
    byCategory: { code: string; name: string; amount: number; budgetAmount: number; variance: number }[];
  };
  ebitda: number;
  ebitdaPorcentaje: number;
  rentabilidadPorLinea: {
    linea: BusinessLine;
    label: string;
    ingresos: number;
    costos: number;
    margen: number;
    margenPorcentaje: number;
  }[];
}


export interface BankBalancesSummary {
  galiciaBalance: number;
  santanderBalance: number;
  bothBanksBalance: number;
  cajaBalance: number;
  banksAndCashBalance: number;
  totalBalance: number;
  hasGaliciaAccount: boolean;
  hasSantanderAccount: boolean;
  hasCajaAccount: boolean;
}
