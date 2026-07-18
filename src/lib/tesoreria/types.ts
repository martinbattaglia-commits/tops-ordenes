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
  "adelanto_director",
  "adelanto_efectivo",
  "reintegro",
  "regularizacion",
  "gasto_operativo",
  "otro",
] as const;
export type OperationalCategory = (typeof OPERATIONAL_CATEGORY_VALUES)[number];

export const OPERATIONAL_CATEGORY_LABELS: Record<OperationalCategory, string> = {
  adelanto_director: "Adelanto al Director",
  adelanto_efectivo: "Adelanto en efectivo",
  reintegro: "Reintegro",
  regularizacion: "Regularización de Tesorería",
  gasto_operativo: "Gasto operativo",
  otro: "Otro movimiento operativo",
};

/** Dirección sugerida por categoría (pre-fill de UI; la RPC valida). */
export const OPERATIONAL_CATEGORY_DIRECTION: Record<OperationalCategory, Direction | null> = {
  adelanto_director: "egreso",
  adelanto_efectivo: "egreso",
  reintegro: "ingreso",
  regularizacion: null, // explícita
  gasto_operativo: "egreso",
  otro: null, // explícita
};

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
