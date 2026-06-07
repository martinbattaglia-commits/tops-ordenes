/**
 * Tipos del módulo OCR — outputs estructurados de documentos corporativos.
 */

export type DocumentType =
  | "factura"
  | "remito"
  | "contrato"
  | "habilitacion"
  | "certificado"
  | "auditoria"
  | "presupuesto"
  | "orden_compra"
  | "orden_servicio"
  | "constancia_afip"
  | "otro";

export interface ExtractedAmount {
  /** Valor numérico (ej 1234567.89). */
  value: number;
  /** Currency code (ARS, USD, EUR). */
  currency: string;
  /** Texto original tal como apareció en el doc (ej "$ 1.234.567,89"). */
  original?: string;
  /** Si es subtotal, IVA, total, etc. */
  kind?: "subtotal" | "iva" | "total" | "neto" | "otro";
}

export interface ExtractedParty {
  /** Razón social o nombre. */
  name: string;
  /** CUIT/CUIL si aparece. */
  taxId?: string;
  /** Domicilio si aparece. */
  address?: string;
  /** Rol en el documento (emisor, receptor, cliente, proveedor). */
  role?: "emisor" | "receptor" | "cliente" | "proveedor" | "destinatario";
}

export interface ExtractedLineItem {
  description: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  subtotal?: number;
  sku?: string;
}

// -------------------------------------------------------------------------
// ERP-B2 · Desglose fiscal avanzado (aditivo). Alimenta el detalle B1
// (supplier_invoice_vat_lines / _other_taxes) vía ap_create_supplier_invoice.
// Opcional: sólo relevante para facturas/NC/ND. No afecta los otros tipos de
// documento (contratos, remitos, etc.), donde queda en null/undefined.
// -------------------------------------------------------------------------

/** Un subtotal de IVA por alícuota. `alicuota` ∈ {0, 2.5, 5, 10.5, 21, 27}. */
export interface ExtractedVatLine {
  /** Alícuota nominal de IVA (porcentaje): 0, 2.5, 5, 10.5, 21 o 27. */
  alicuota: number;
  /** Base imponible (neto gravado) a esa alícuota. */
  baseNeto: number;
  /** IVA liquidado para esa base (≈ baseNeto · alicuota / 100). */
  importeIva: number;
}

export type ExtractedOtherTaxKind =
  | "PERCEPCION_IVA"
  | "PERCEPCION_IIBB"
  | "PERCEPCION_GANANCIAS"
  | "IMPUESTO_INTERNO"
  | "OTRO";

/** Una percepción / retención / impuesto interno (NO es crédito fiscal de IVA). */
export interface ExtractedOtherTax {
  kind: ExtractedOtherTaxKind;
  /** Provincia (obligatorio en IIBB). */
  jurisdiction?: string | null;
  base?: number | null;
  alicuota?: number | null;
  importe: number;
}

/** Bloque fiscal de una factura de proveedor (multi-alícuota + percepciones). */
export interface ExtractedFiscal {
  vatLines: ExtractedVatLine[];
  otherTaxes: ExtractedOtherTax[];
  /** Neto no gravado (sin IVA por naturaleza). */
  netoNoGravado?: number | null;
  /** Neto exento. */
  netoExento?: number | null;
  /** Total declarado en el comprobante (para validación cruzada). */
  totalDeclarado?: number | null;
}

/**
 * Datos discretos del comprobante fiscal argentino (factura/NC/ND/recibo).
 *
 * Se piden explícitamente al modelo porque, en el camino de IMAGEN (Vision),
 * `rawText` queda vacío y las heurísticas por regex sobre el texto bruto no
 * pueden recuperar punto de venta ni CAE. Tenerlos como campos discretos hace
 * que el OCR de imagen no pierda PV/CAE ni reporte una confianza engañosa.
 */
export interface ExtractedComprobante {
  /** Letra fiscal: A, B, C, M o null si no aplica/no se detecta. */
  letra: "A" | "B" | "C" | "M" | null;
  /** Clase de comprobante. */
  clase: "factura" | "nota_credito" | "nota_debito" | "recibo" | "otro" | null;
  /** Punto de venta tal cual figura (ej "0003"); null si no aparece. */
  puntoVenta: string | null;
  /** Número del comprobante (ej "00001234"); null si no aparece. */
  numero: string | null;
  /** CAE de 14 dígitos; null si no aparece (típico en remitos/recibos). */
  cae: string | null;
}

export interface ExtractedDocument {
  /** Clasificación inferida. */
  type: DocumentType;
  /** Confianza 0-1 de la clasificación. */
  typeConfidence: number;
  /** Título o número de identificación (ej "FA A 0003-00080012", "RNE 2-051-00427"). */
  title: string | null;
  /** Fecha emisión en formato YYYY-MM-DD. */
  date: string | null;
  /** Fecha vencimiento si aplica (contratos, habilitaciones). */
  expiresAt: string | null;
  /** Resumen ejecutivo en español, 1-2 oraciones. */
  summary: string;
  /** Partes involucradas. */
  parties: ExtractedParty[];
  /** Montos relevantes. */
  amounts: ExtractedAmount[];
  /** Items línea por línea (si es factura/remito/OC). */
  lineItems: ExtractedLineItem[];
  /** Datos discretos del comprobante fiscal (solo facturas/NC/ND/recibos). */
  comprobante?: ExtractedComprobante | null;
  /** Desglose fiscal avanzado (ERP-B2): IVA por alícuota + percepciones. */
  fiscal?: ExtractedFiscal | null;
  /** Tags sugeridos para indexar (ej ["ANMAT", "cosmética", "urgente"]). */
  tags: string[];
  /** Texto bruto extraído del doc (para búsqueda full-text). */
  rawText: string;
  /** Diagnóstico técnico. */
  meta: {
    sourceKind: "pdf_text" | "pdf_image" | "image";
    pages: number;
    charCount: number;
    model: string;
    tokensUsed: number;
    elapsedMs: number;
  };
}
