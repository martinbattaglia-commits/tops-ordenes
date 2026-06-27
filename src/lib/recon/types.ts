// src/lib/recon/types.ts

export type ReconStatus =
  | "pendiente"
  | "en_revision"
  | "conciliada"
  | "con_diferencias"
  | "rechazada";

export type ReconDiffSeverity = "info" | "warning" | "error";

export type ReconDiffField =
  | "proveedor"
  | "cuit"
  | "moneda"
  | "cond_pago"
  | "fecha_emision"
  | "neto"
  | "iva"
  | "percepciones"
  | "tributos"
  | "total"
  | "cantidad_items"
  | "precio_unitario"
  | "tipo_comprobante"
  | "punto_venta"
  | "numero"
  | "cae"
  | "otros";

export interface ReconDiff {
  field: ReconDiffField;
  val_oc: string;
  val_factura: string;
  delta_num?: number;
  severity: ReconDiffSeverity;
}

export interface ReconResult {
  score: number;       // 0–100
  diffs: ReconDiff[];
}

/** Shape mínima de OC que el motor necesita */
export interface POForRecon {
  id: string;
  public_id: string;
  vendor_id: string;
  neto: number;
  iva: number;
  total: number;
  moneda?: string;
  cond_pago?: string;
  items: Array<{ descripcion: string; cantidad: number; precio_unitario: number }>;
  vendor?: { cuit?: string; razon_social?: string };
}

/** Shape mínima de Factura que el motor necesita */
export interface InvoiceForRecon {
  id: string;
  public_id: string;
  vendor_id: string;
  tipo_comprobante: string;
  punto_venta: number;
  numero: string;
  cae?: string | null;
  fecha_emision: string;
  fecha_vencimiento?: string | null;
  moneda?: string | null;
  neto: number;
  iva: number;
  percepciones?: number | null;
  tributos?: number | null;
  total: number;
  vendor?: { cuit?: string; razon_social?: string };
}

export interface ReconRecord {
  id: string;
  purchase_order_id: string;
  supplier_invoice_id: string;
  status: ReconStatus;
  score: number;
  initiated_by: string;
  initiated_at: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  diffs: ReconDiffRecord[];
  events: ReconEvent[];
}

export interface ReconDiffRecord extends ReconDiff {
  id: string;
  reconciliation_id: string;
  accepted: boolean;
  accepted_by?: string | null;
  accepted_at?: string | null;
  accept_note?: string | null;
}

export interface ReconEvent {
  id: number;
  reconciliation_id: string;
  ts: string;
  user_id: string;
  action: string;
  from_status?: ReconStatus | null;
  to_status?: ReconStatus | null;
  note?: string | null;
  meta?: Record<string, unknown> | null;
}

// Meta para badges y colores
export const RECON_STATUS_META: Record<ReconStatus, { label: string; cls: string }> = {
  pendiente:        { label: "Pendiente",      cls: "badge-warning" },
  en_revision:      { label: "En revisión",    cls: "badge-info" },
  conciliada:       { label: "Conciliada",     cls: "badge-success" },
  con_diferencias:  { label: "Con diferencias",cls: "badge-warning" },
  rechazada:        { label: "Rechazada",      cls: "badge-danger" },
};

export const RECON_DIFF_FIELD_LABEL: Record<ReconDiffField, string> = {
  proveedor:       "Proveedor",
  cuit:            "CUIT",
  moneda:          "Moneda",
  cond_pago:       "Condición de pago",
  fecha_emision:   "Fecha de emisión",
  neto:            "Importe neto",
  iva:             "IVA",
  percepciones:    "Percepciones",
  tributos:        "Tributos",
  total:           "Total",
  cantidad_items:  "Cantidad de ítems",
  precio_unitario: "Precio unitario",
  tipo_comprobante:"Tipo de comprobante",
  punto_venta:     "Punto de venta",
  numero:          "Número",
  cae:             "CAE",
  otros:           "Otros",
};

export const SEVERITY_WEIGHT: Record<ReconDiffSeverity, number> = {
  info:    2,   // descuenta poco
  warning: 10,  // descuenta moderado
  error:   25,  // descuenta fuerte
};
