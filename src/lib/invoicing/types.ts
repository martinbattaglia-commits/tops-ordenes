/**
 * Tipos del dominio de Facturación (módulo ARCA).
 * Alineados con `supabase/migrations/0011_arca_billing.sql`.
 */

import type { CbteTipoCode, ConceptoCode, DocTipoCode } from "@/lib/arca/types";

export type CondicionIva =
  | "RESPONSABLE_INSCRIPTO"
  | "MONOTRIBUTO"
  | "EXENTO"
  | "CONSUMIDOR_FINAL"
  | "NO_RESPONSABLE"
  | "NO_CATEGORIZADO";

export type ComprobanteTipo =
  | "FACTURA_A"
  | "NOTA_DEBITO_A"
  | "NOTA_CREDITO_A"
  | "FACTURA_B"
  | "NOTA_DEBITO_B"
  | "NOTA_CREDITO_B"
  | "FACTURA_C"
  | "NOTA_DEBITO_C"
  | "NOTA_CREDITO_C"
  | "FACTURA_E";

export type InvoiceArcaStatus =
  | "BORRADOR"
  | "PENDIENTE_ARCA"
  | "ENVIADO_ARCA"
  | "AUTORIZADO_ARCA"
  | "RECHAZADO_ARCA"
  | "ERROR_ARCA"
  | "ANULADO";

export type ArcaAmbiente = "SANDBOX" | "HOMOLOGACION" | "PRODUCCION";

export type PuntoVentaTipo = "WEBSERVICE" | "CONTROLADOR_FISCAL" | "MANUAL";

export interface FiscalConfig {
  id: number;
  razon_social: string;
  nombre_fantasia: string | null;
  cuit: string;
  ingresos_brutos: string | null;
  inicio_actividades: string | null;
  domicilio_comercial: string | null;
  localidad: string | null;
  provincia: string | null;
  condicion_iva: CondicionIva;
  ambiente: ArcaAmbiente;
  cert_alias: string | null;
  default_punto_venta: number | null;
  logo_url: string | null;
  pie_legal: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface PuntoVenta {
  id: string;
  numero: number;
  descripcion: string;
  tipo: PuntoVentaTipo;
  activo: boolean;
  created_at: string;
}

export interface InvoiceItem {
  id?: string;
  invoice_id?: string;
  order_id?: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  alicuota_iva: number; // 0 / 10.5 / 21 / 27
  alic_iva_id: number;
  importe_neto: number;
  importe_iva: number;
  importe_total: number;
  orden: number;
}

export interface CustomerInvoice {
  id: string;
  client_id: string | null;
  cuit_cliente: string | null;
  razon_social: string;
  condicion_iva: CondicionIva;
  domicilio_cliente: string | null;
  doc_tipo: DocTipoCode;

  tipo_comprobante: ComprobanteTipo;
  cbte_tipo_arca: CbteTipoCode;
  concepto: ConceptoCode;
  punto_venta: number;
  numero_comprobante: number | null;

  fch_serv_desde: string | null;
  fch_serv_hasta: string | null;
  fch_vto_pago: string | null;
  periodo: string | null;

  cae: string | null;
  fecha_vencimiento_cae: string | null;
  fecha_autorizacion_arca: string | null;

  qr_data: string | null;
  qr_url: string | null;
  qr_hash: string | null;

  subtotal: number;
  importe_no_gravado: number;
  importe_exento: number;
  iva: number;
  percepciones: number;
  tributos: number;
  total: number;
  moneda: string;
  cotizacion: number;

  estado_arca: InvoiceArcaStatus;
  request_arca: unknown | null;
  response_arca: unknown | null;
  ambiente: ArcaAmbiente;
  error_msg: string | null;

  comprobante_asociado_id: string | null;
  anulada: boolean;

  pdf_bucket: string | null;
  pdf_path: string | null;
  pdf_url: string | null;

  observ: string | null;
  emitido_por: string | null;
  created_at: string;
  updated_at: string;

  items?: InvoiceItem[];
}

export interface InvoiceAuditEntry {
  id: number;
  invoice_id: string | null;
  ts: string;
  user_id: string | null;
  action: string;
  estado: InvoiceArcaStatus | null;
  cae: string | null;
  request: unknown | null;
  response: unknown | null;
  ip: string | null;
}

/** Metadata visual de cada estado fiscal (badges). */
export const INVOICE_STATUS_META: Record<
  InvoiceArcaStatus,
  { label: string; cls: string }
> = {
  BORRADOR: { label: "Borrador", cls: "badge-muted" },
  PENDIENTE_ARCA: { label: "Pendiente ARCA", cls: "badge-warning" },
  ENVIADO_ARCA: { label: "Enviado a ARCA", cls: "badge-info" },
  AUTORIZADO_ARCA: { label: "Autorizado ARCA", cls: "badge-success" },
  RECHAZADO_ARCA: { label: "Rechazado ARCA", cls: "badge-danger" },
  ERROR_ARCA: { label: "Error ARCA", cls: "badge-danger" },
  ANULADO: { label: "Anulado", cls: "badge-muted" },
};

export const COMPROBANTE_LABEL: Record<ComprobanteTipo, string> = {
  FACTURA_A: "Factura A",
  NOTA_DEBITO_A: "Nota de Débito A",
  NOTA_CREDITO_A: "Nota de Crédito A",
  FACTURA_B: "Factura B",
  NOTA_DEBITO_B: "Nota de Débito B",
  NOTA_CREDITO_B: "Nota de Crédito B",
  FACTURA_C: "Factura C",
  NOTA_DEBITO_C: "Nota de Débito C",
  NOTA_CREDITO_C: "Nota de Crédito C",
  FACTURA_E: "Factura E (Exportación)",
};

/** Letra del comprobante (para el recuadro fiscal del PDF). */
export const COMPROBANTE_LETRA: Record<ComprobanteTipo, "A" | "B" | "C" | "E"> = {
  FACTURA_A: "A",
  NOTA_DEBITO_A: "A",
  NOTA_CREDITO_A: "A",
  FACTURA_B: "B",
  NOTA_DEBITO_B: "B",
  NOTA_CREDITO_B: "B",
  FACTURA_C: "C",
  NOTA_DEBITO_C: "C",
  NOTA_CREDITO_C: "C",
  FACTURA_E: "E",
};
