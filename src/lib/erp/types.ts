/**
 * Tipos del módulo ERP financiero (Fase 3): facturas de proveedores
 * (cuentas por pagar) + centros de costo. Espeja el schema de la migración
 * `0014_supplier_invoices`.
 */

export type SupplierInvoiceStatus =
  | "pendiente"
  | "conciliada"
  | "aprobada"
  | "pagada"
  | "anulada";

export type SupplierComprobante =
  | "FACTURA_A"
  | "FACTURA_B"
  | "FACTURA_C"
  | "NOTA_CREDITO_A"
  | "NOTA_CREDITO_B"
  | "NOTA_CREDITO_C"
  | "NOTA_DEBITO_A"
  | "NOTA_DEBITO_B"
  | "NOTA_DEBITO_C"
  | "RECIBO"
  | "OTRO";

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  depot: string | null;
  active: boolean;
  created_at: string;
}

/** Proveedor embebido (subset de vendors). */
export interface SupplierRef {
  id: string;
  razon: string;
  cuit: string;
}

export interface SupplierInvoice {
  id: string;
  short_id: number;
  public_id: string;
  vendor_id: string;
  cost_center_id: string | null;
  purchase_order_id: string | null;
  tipo_comprobante: SupplierComprobante;
  punto_venta: number;
  numero: string;
  cae: string | null;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  moneda: string;
  neto: number;
  iva: number;
  percepciones: number;
  total: number;
  status: SupplierInvoiceStatus;
  observ: string | null;
  pdf_url: string | null;
  created_at: string;
  // embeds
  vendor?: SupplierRef | null;
  cost_center?: Pick<CostCenter, "id" | "code" | "name"> | null;
}

/** Etiqueta + colores (inline style) por estado, mismo criterio que roles/billing. */
export const SUPPLIER_INVOICE_STATUS_META: Record<
  SupplierInvoiceStatus,
  { label: string; color: string }
> = {
  pendiente: { label: "Pendiente", color: "#B45309" },
  conciliada: { label: "Conciliada", color: "#214576" },
  aprobada: { label: "Aprobada", color: "#3a6db0" },
  pagada: { label: "Pagada", color: "#15803D" },
  anulada: { label: "Anulada", color: "#8A94A6" },
};

export const SUPPLIER_COMPROBANTE_LABEL: Record<SupplierComprobante, string> = {
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  FACTURA_C: "Factura C",
  NOTA_CREDITO_A: "Nota de Crédito A",
  NOTA_CREDITO_B: "Nota de Crédito B",
  NOTA_CREDITO_C: "Nota de Crédito C",
  NOTA_DEBITO_A: "Nota de Débito A",
  NOTA_DEBITO_B: "Nota de Débito B",
  NOTA_DEBITO_C: "Nota de Débito C",
  RECIBO: "Recibo",
  OTRO: "Otro",
};

export const SUPPLIER_COMPROBANTE_VALUES = Object.keys(
  SUPPLIER_COMPROBANTE_LABEL
) as SupplierComprobante[];
