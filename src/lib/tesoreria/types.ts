/**
 * Tipos del dominio Tesorería (ERP-A3). Espejan los enums de `0053`/`0054` y
 * los DTOs que devuelven las vistas derivadas. Read-only del lado TS:
 * NINGÚN saldo se calcula acá (D1/D5) — todo viene de las vistas.
 */

// ── Enums (espejo de treasury_* en 0053) ───────────────────────────────────
export const RECEIPT_METHOD_VALUES = ["transferencia", "efectivo", "cheque", "echeq"] as const;
export type ReceiptMethod = (typeof RECEIPT_METHOD_VALUES)[number];

export const PAYMENT_METHOD_VALUES = ["transferencia", "cheque", "echeq"] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number];

export const MOVEMENT_TYPE_VALUES = ["cobranza", "pago_proveedor", "transferencia", "ajuste", "movimiento_operativo"] as const;
export type MovementType = (typeof MOVEMENT_TYPE_VALUES)[number];

/** Etiquetas legibles del tipo de movimiento (historial). */
export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  cobranza: "Cobranza",
  pago_proveedor: "Pago a proveedor",
  transferencia: "Transferencia",
  ajuste: "Ajuste (baseline)",
  movimiento_operativo: "Movimiento operativo",
};

// ── Movimientos Operativos (ERP-A · operatoria diaria) ──────────────────────
// Categoría con identidad propia. 'regularizacion' reemplaza al antiguo ajuste
// operativo; la palabra "ajuste" queda reservada a la baseline. Las transferencias
// NO están acá: usan el flujo de Transferencias. Espeja treasury_operational_category_t.
export const OPERATIONAL_CATEGORY_VALUES = [
  "honorarios",
  "adelanto_sueldo",
  "adelanto_director",
  "adelanto_efectivo",
  "reintegro",
  "regularizacion",
  "gasto_operativo",
  "otro",
] as const;
export type OperationalCategory = (typeof OPERATIONAL_CATEGORY_VALUES)[number];

export const OPERATIONAL_CATEGORY_LABELS: Record<OperationalCategory, string> = {
  honorarios: "Honorarios",
  adelanto_sueldo: "Adelanto de sueldo",
  adelanto_director: "Adelanto al Director",
  adelanto_efectivo: "Adelanto en efectivo",
  reintegro: "Reintegro",
  regularizacion: "Regularización de Tesorería",
  gasto_operativo: "Gasto operativo",
  otro: "Otro movimiento operativo",
};

/** Dirección sugerida por categoría (pre-fill de UI; la RPC valida). */
export const OPERATIONAL_CATEGORY_DIRECTION: Record<OperationalCategory, Direction | null> = {
  honorarios: "egreso",
  adelanto_sueldo: "egreso",
  adelanto_director: "egreso",
  adelanto_efectivo: "egreso",
  reintegro: "ingreso",
  regularizacion: null, // explícita
  gasto_operativo: "egreso",
  otro: null, // explícita
};

/**
 * Categorías que EXIGEN identificar al beneficiario. Espeja exactamente el
 * constraint `treasury_movements_beneficiary_required_ck` y la guarda
 * BENEFICIARY_REQUIRED de la RPC (0194). Es un espejo para que la UI avise
 * ANTES de ir al servidor — la regla dura vive en la base, no acá.
 */
export const OPERATIONAL_CATEGORY_REQUIRES_BENEFICIARY: Record<OperationalCategory, boolean> = {
  honorarios: true,
  adelanto_sueldo: true,
  adelanto_director: true,
  adelanto_efectivo: true,
  reintegro: true,
  regularizacion: false,
  gasto_operativo: false,
  otro: false,
};

// ── Beneficiarios (catálogo propio de Tesorería · 0194) ────────────────────
// NO es `vendors` (un director no es proveedor) ni `rrhh_empleados` (su RLS
// exige 'rrhh.view', que el operador de Tesorería no tiene).
export const BENEFICIARY_KIND_VALUES = ["empleado", "director", "profesional", "tercero"] as const;
export type BeneficiaryKind = (typeof BENEFICIARY_KIND_VALUES)[number];

export const BENEFICIARY_KIND_LABELS: Record<BeneficiaryKind, string> = {
  empleado: "Empleado",
  director: "Director",
  profesional: "Profesional / honorarios",
  tercero: "Tercero",
};

export interface Beneficiary {
  id: string;
  full_name: string;
  kind: BeneficiaryKind;
  document_id: string | null;
  active: boolean;
}

export const DIRECTION_VALUES = ["ingreso", "egreso"] as const;
export type Direction = (typeof DIRECTION_VALUES)[number];

export const MOVEMENT_STATUS_VALUES = ["pendiente", "confirmado", "anulado"] as const;
export type MovementStatus = (typeof MOVEMENT_STATUS_VALUES)[number];

export const VOID_TARGET_VALUES = ["receipt", "payment", "transfer", "movement"] as const;
export type VoidTarget = (typeof VOID_TARGET_VALUES)[number];

// ── DTOs de vistas derivadas (lectura) ─────────────────────────────────────
export interface BankAccount {
  id: string;
  bank_name: string;
  account_name: string;
  account_type: string;
  currency: string;
  alias: string | null;
  cbu: string | null;
  opening_balance: number;
  active: boolean;
  is_system: boolean;
}

/** treasury_bank_balances — D1: `balance` es DERIVADO en la vista, no en TS. */
export interface BankBalance {
  bank_account_id: string;
  bank_name: string;
  account_name: string;
  account_type: string;
  currency: string;
  is_system: boolean;
  opening_balance: number;
  balance: number;
}

export interface TreasuryMovement {
  id: string;
  public_id: string;
  date: string;
  type: MovementType;
  direction: Direction;
  bank_account_id: string;
  amount: number;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  transfer_group_id: string | null;
  status: MovementStatus;
  operational_category: OperationalCategory | null;
  beneficiary_id: string | null;
  created_at: string;
}

/**
 * treasury_operational_movements (vista `security_invoker`, 0194) — movimientos
 * operativos con el beneficiario ya resuelto. La UI no arma el join a mano.
 */
export interface OperationalMovement {
  id: string;
  public_id: string;
  date: string;
  direction: Direction;
  bank_account_id: string;
  amount: number;
  description: string | null;
  operational_category: OperationalCategory;
  status: MovementStatus;
  beneficiary_id: string | null;
  beneficiary_name: string | null;
  beneficiary_kind: BeneficiaryKind | null;
  beneficiary_document: string | null;
  created_at: string;
}

export type CobroEstado = "cobrada" | "parcial" | "vencida" | "pendiente";
export type PagoEstado = "pagada" | "parcial" | "vencida" | "pendiente";

export interface CustomerOpenItem {
  invoice_id: string;
  client_id: string | null;
  numero_comprobante: number | null;
  total: number;
  fch_vto_pago: string | null;
  pagado: number;
  saldo: number;
  estado_cobro: CobroEstado;
}

export interface SupplierOpenItem {
  invoice_id: string;
  vendor_id: string;
  public_id: string;
  total: number;
  fecha_vencimiento: string | null;
  pagado: number;
  saldo: number;
  estado_pago: PagoEstado;
}

/** customer_current_account — D5: cuenta corriente DERIVADA en la vista. */
export interface CustomerCurrentAccount {
  client_id: string | null;
  facturas_abiertas: number;
  total_facturado: number;
  total_cobrado: number;
  saldo_cuenta: number;
  proxima_vencimiento: string | null;
}

/** supplier_current_account — D5: cuenta corriente DERIVADA en la vista. */
export interface SupplierCurrentAccount {
  vendor_id: string;
  facturas_abiertas: number;
  total_facturado: number;
  total_pagado: number;
  saldo_cuenta: number;
  proxima_vencimiento: string | null;
}

export interface CashflowRow {
  fecha: string;
  tipo: "cobro" | "pago";
  monto: number;
  flujo_acumulado: number;
}

// ── Resultado de Server Actions (patrón de la casa) ────────────────────────
export type ActionResult<T = unknown> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };
