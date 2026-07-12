/**
 * Tipos del bounded context Contabilidad (F6 · piloto en modo SIMULATION).
 *
 * Espejan 1:1 las columnas de las vistas SQL del motor contable
 * (v_libro_diario, v_libro_mayor, v_balance_sumas_saldos,
 * v_comprobantes_sin_asiento, v_iva_fiscal_vs_contable,
 * v_asientos_descuadrados). El motor vive íntegramente en la base:
 * esta capa es de CONSULTA — no crea, no postea, no revierte.
 */

import type { AccountType } from "@/lib/erp/types";

/** Tipos de comprobante que el motor sabe contabilizar (journal_source_t). */
export type JournalSourceType =
  | "customer_invoice"
  | "supplier_invoice"
  | "customer_receipt"
  | "supplier_payment"
  | "manual"
  | "adjustment"
  | "opening";

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  customer_invoice: "Factura de venta",
  supplier_invoice: "Factura de proveedor",
  customer_receipt: "Recibo de cobranza",
  supplier_payment: "Orden de pago",
  manual: "Asiento manual",
  adjustment: "Ajuste",
  opening: "Apertura",
};

export interface LibroDiarioRow {
  entry_id: string;
  entry_number: number;
  entry_date: string;
  periodo: string;
  source_type: JournalSourceType;
  source_id: string | null;
  asiento_descripcion: string | null;
  status: string;
  line_no: number;
  cuenta_codigo: string;
  cuenta_nombre: string;
  cuenta_tipo: AccountType;
  linea_descripcion: string | null;
  debit: number;
  credit: number;
  centro_costo: string | null;
}

export interface LibroMayorRow {
  account_id: string;
  cuenta_codigo: string;
  cuenta_nombre: string;
  cuenta_tipo: AccountType;
  entry_id: string;
  entry_number: number;
  entry_date: string;
  periodo: string;
  linea_descripcion: string | null;
  debit: number;
  credit: number;
  saldo_acumulado: number;
}

export interface SumasSaldosRow {
  account_id: string;
  cuenta_codigo: string;
  cuenta_nombre: string;
  cuenta_tipo: AccountType;
  total_debe: number;
  total_haber: number;
  saldo_deudor: number;
  saldo_acreedor: number;
}

export interface ComprobanteSinAsiento {
  source_type: string;
  source_id: string;
  fecha: string;
  referencia: string | null;
  entidad: string | null;
  importe: number;
}

export interface ConciliacionIvaRow {
  periodo: string;
  iva_debito_fiscal: number;
  iva_debito_contable: number;
  dif_debito: number;
  iva_credito_fiscal: number;
  iva_credito_contable: number;
  dif_credito: number;
}

export interface AsientoDescuadrado {
  entry_id: string;
  entry_number: number;
  entry_date: string;
  total_debe: number;
  total_haber: number;
  diferencia: number;
}

/** Fotografía del estado del motor para el dashboard contable. */
export interface MotorStatus {
  asientos: number;
  comprobantesPendientes: number;
  descuadrados: number;
  periodos: number;
  cuentasActivas: number;
  reglas: number;
}

/** Línea del asiento propuesto por el dry-run, enriquecida con el catálogo. */
export interface SimulacionLinea {
  account_id: string;
  cuenta_codigo: string | null;
  cuenta_nombre: string | null;
  description: string | null;
  debit: number;
  credit: number;
  centro_costo: string | null;
  line_no: number;
}

/** Resultado de simular la contabilización de un comprobante (dry-run). */
export interface SimulacionResult {
  ok: boolean;
  /** true = el motor ya tiene asiento activo para este comprobante. */
  yaContabilizado?: boolean;
  debit?: number;
  credit?: number;
  balanced?: boolean;
  lineas?: SimulacionLinea[];
  /** Mensaje de error legible (permiso, descuadre, regla faltante, etc.). */
  error?: string;
}

export interface LibroDiarioFilters {
  desde: string;
  hasta: string;
  sourceType: string | null;
}

export interface LibroMayorFilters {
  accountId: string | null;
  desde: string;
  hasta: string;
}
