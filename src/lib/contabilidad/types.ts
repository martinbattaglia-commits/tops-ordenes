/**
 * Tipos del módulo de Contabilidad (capa contable, migraciones 0082-0086).
 *
 * Los importes vienen PRECOMPUTADOS por las vistas SQL (v_*); el frontend solo
 * los muestra y totaliza, nunca recalcula contabilidad.
 */

export type AccountType =
  | "activo"
  | "pasivo"
  | "patrimonio_neto"
  | "ingreso"
  | "gasto"
  | "orden";

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  activo: "Activo",
  pasivo: "Pasivo",
  patrimonio_neto: "Patrimonio Neto",
  ingreso: "Ingreso",
  gasto: "Gasto / Costo",
  orden: "Cuenta de orden",
};

export type JournalSource =
  | "customer_invoice"
  | "supplier_invoice"
  | "customer_receipt"
  | "supplier_payment"
  | "manual"
  | "adjustment"
  | "opening";

export const SOURCE_LABEL: Record<string, string> = {
  customer_invoice: "Factura de venta",
  supplier_invoice: "Factura de compra",
  customer_receipt: "Cobranza",
  supplier_payment: "Pago a proveedor",
  manual: "Asiento manual",
  adjustment: "Ajuste",
  opening: "Apertura",
};

export interface ChartAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  parentId: string | null;
  isPostable: boolean;
  isActive: boolean;
  isSystem: boolean;
}

export interface PosicionIvaRow {
  periodo: string;
  ivaDebitoFiscal: number;
  ivaCreditoFiscal: number;
  saldoTecnico: number;
  percepcionesIvaSufridas: number;
  retencionesSufridas: number;
  saldoPosicion: number;
  resultado: "a_pagar" | "a_favor" | "neutro";
}

export interface DiarioRow {
  entryId: string;
  entryNumber: number | null;
  entryDate: string;
  periodo: string;
  sourceType: string;
  asientoDescripcion: string | null;
  lineNo: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  cuentaTipo: AccountType;
  lineaDescripcion: string | null;
  debit: number;
  credit: number;
  centroCosto: string | null;
}

export interface MayorRow {
  accountId: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  cuentaTipo: AccountType;
  entryNumber: number | null;
  entryDate: string;
  periodo: string;
  lineaDescripcion: string | null;
  debit: number;
  credit: number;
  saldoAcumulado: number;
}

export interface BalanceRow {
  accountId: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  cuentaTipo: AccountType;
  totalDebe: number;
  totalHaber: number;
  saldoDeudor: number;
  saldoAcreedor: number;
}

export interface ResultadoRow {
  periodo: string;
  cuentaTipo: AccountType;
  cuentaCodigo: string;
  cuentaNombre: string;
  debe: number;
  haber: number;
  neto: number;
}

export interface ComprobanteSinAsiento {
  sourceType: string;
  sourceId: string;
  fecha: string;
  referencia: string | null;
  entidad: string | null;
  importe: number;
}

// ----- Fase 10: percepciones de venta y retenciones practicadas -----

export type SalesOtherTaxType =
  | "PERCEPCION_IVA"
  | "PERCEPCION_IIBB"
  | "PERCEPCION_MUNICIPAL"
  | "IMPUESTO_INTERNO"
  | "OTRO";

export const SALES_OTHER_TAX_LABEL: Record<string, string> = {
  PERCEPCION_IVA: "Percepción IVA",
  PERCEPCION_IIBB: "Percepción IIBB",
  PERCEPCION_MUNICIPAL: "Percepción Municipal",
  IMPUESTO_INTERNO: "Impuesto interno",
  OTRO: "Otro tributo",
};

export type SupplierWithholdingType =
  | "RETENCION_IVA"
  | "RETENCION_GANANCIAS"
  | "RETENCION_IIBB"
  | "RETENCION_SUSS"
  | "OTRA";

export const WITHHOLDING_LABEL: Record<string, string> = {
  RETENCION_IVA: "Retención IVA",
  RETENCION_GANANCIAS: "Retención Ganancias",
  RETENCION_IIBB: "Retención IIBB",
  RETENCION_SUSS: "Retención SUSS",
  OTRA: "Otra retención",
};

export interface PercepcionVentaRow {
  periodo: string;
  taxType: string;
  jurisdiction: string;
  comprobantes: number;
  baseImponible: number;
  importe: number;
}

export interface RetencionPracticadaRow {
  periodo: string;
  withholdingType: string;
  jurisdiction: string;
  pagos: number;
  retenciones: number;
  baseImponible: number;
  importe: number;
}

export interface PagoProveedorRetencionRow {
  paymentId: string;
  publicId: string | null;
  proveedor: string | null;
  periodo: string;
  pagoBruto: number;
  retenciones: number;
  pagoNeto: number;
}

export interface PosicionFiscalRow {
  periodo: string;
  ivaSaldoPosicion: number;
  ivaResultado: string;
  percepcionesVentasADepositar: number;
  retencionesPracticadasADepositar: number;
  percepcionesIvaSufridas: number;
  retencionesSufridas: number;
}
