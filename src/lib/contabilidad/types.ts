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

// ----- Fase 11: opciones para formularios -----

export interface VendorOption {
  id: string;
  razon: string;
  cuit: string;
}

export interface BankOption {
  id: string;
  label: string;
  isSystem: boolean;
}

export interface SupplierOpenItemOption {
  invoiceId: string;
  vendorId: string;
  publicId: string;
  total: number;
  saldo: number;
  estadoPago: string;
}

export interface CustomerInvoiceOption {
  id: string;
  label: string;
  percepciones: number;
  tributos: number;
}

// ----- Fase 12: centros de costo, logística facturable, cierre -----

export interface CentroCostoRow {
  id: string;
  code: string;
  name: string;
  type: string | null;
  active: boolean;
}

export interface ResultadoCCRow {
  periodo: string;
  centroCostoCode: string;
  centroCostoNombre: string;
  tipo: string | null;
  ingresos: number;
  gastos: number;
  resultado: number;
  margenPct: number | null;
}

export interface OrdenFacturableRow {
  orderId: string;
  publicId: string;
  clientName: string;
  customerRef: string | null;
  status: string;
  fecha: string;
  billingStatus: string;
  billableAmount: number | null;
}

export interface OrdenFacturadaRow {
  orderId: string;
  publicId: string;
  clientName: string;
  customerInvoiceId: string | null;
  facturaTotal: number | null;
  periodoStart: string | null;
  periodoEnd: string | null;
}

export interface PeriodoCierreRow {
  periodId: string;
  year: number;
  month: number;
  status: string;
  descuadrados: number;
  comprobantesSinAsiento: number;
  ivaDiffs: number;
  listo: boolean;
}

// ----- Fase 13: servicios, tarifas, billing runs, pricing, refundición anual -----

export interface BillableServiceRow {
  id: string;
  code: string;
  name: string;
  serviceType: string;
  unit: string;
  defaultVatRate: number;
  isActive: boolean;
}

export interface TarifaRow {
  rateId: string;
  cliente: string;
  servicioCode: string;
  servicio: string;
  currency: string;
  unitPrice: number;
  vatRate: number;
  billingFrequency: string;
  validFrom: string;
  validTo: string | null;
}

export interface TarifaVencidaRow {
  rateId: string;
  cliente: string;
  servicioCode: string;
  servicio: string;
  unitPrice: number;
  validFrom: string;
  validTo: string | null;
}

export interface BillingRunRow {
  billingRunId: string;
  periodStart: string;
  periodEnd: string;
  runType: string;
  status: string;
  items: number;
  totalBruto: number;
}

export interface BillingRunItemRow {
  itemId: string;
  billingRunId: string;
  cliente: string;
  servicioCode: string;
  servicio: string;
  quantity: number;
  unitPrice: number;
  netAmount: number;
  vatRate: number;
  vatAmount: number;
  grossAmount: number;
  status: string;
  customerInvoiceId: string | null;
  customerId: string;
}

export interface OrdenPricingRow {
  orderId: string;
  publicId: string;
  clientName: string;
  clientMatches: number;
  itemsCount: number;
  priceable: boolean;
  motivoNoPriceable: string;
}

export interface ResultadoAnualRow {
  ejercicio: number;
  ingresos: number;
  gastos: number;
  resultadoEjercicio: number;
}
