import { z } from "zod";
import { SUPPLIER_COMPROBANTE_VALUES } from "./types";

// ERP-B2 · Pares AFIP válidos (alic_iva_id ↔ alícuota). Espejo de 0056:89-93.
const AFIP_PAIRS = new Set(["3:0", "4:10.5", "5:21", "6:27", "8:5", "9:2.5"]);
const AP_OTHER_TAX_KINDS = [
  "PERCEPCION_IVA",
  "PERCEPCION_IIBB",
  "PERCEPCION_GANANCIAS",
  "IMPUESTO_INTERNO",
  "OTRO",
] as const;

export const VatLineSchema = z
  .object({
    alic_iva_id: z.coerce.number().int(),
    alicuota_iva: z.coerce.number().min(0),
    base_neto: z.coerce.number().min(0),
    importe_iva: z.coerce.number().min(0),
  })
  // V1: el par (alic_iva_id, alícuota) debe ser AFIP válido
  .refine((l) => AFIP_PAIRS.has(`${l.alic_iva_id}:${l.alicuota_iva}`), {
    message: "Alícuota de IVA no válida para AFIP",
  })
  // V2: importe_iva coherente con base·alícuota (tolerancia 0.05 en cliente)
  .refine(
    (l) => Math.abs(l.importe_iva - Math.round((l.base_neto * l.alicuota_iva) / 100 * 100) / 100) <= 0.05,
    { message: "El IVA del renglón no coincide con base × alícuota" }
  );

export const OtherTaxSchema = z
  .object({
    tax_kind: z.enum(AP_OTHER_TAX_KINDS),
    jurisdiction: z.string().trim().max(60).optional().nullable(),
    base: z.coerce.number().min(0).optional().nullable(),
    alicuota: z.coerce.number().min(0).optional().nullable(),
    importe: z.coerce.number().min(0),
  })
  // V5: IIBB exige jurisdicción
  .refine((t) => t.tax_kind !== "PERCEPCION_IIBB" || !!(t.jurisdiction && t.jurisdiction.trim().length > 0), {
    message: "La percepción de IIBB requiere jurisdicción (provincia)",
  });

export const ItemSchema = z.object({
  descripcion: z.string().trim().min(1).max(300),
  cantidad: z.coerce.number().min(0).default(1),
  precio_unitario: z.coerce.number().default(0),
  alic_iva_id: z.coerce.number().int().default(5),
  importe_neto: z.coerce.number().default(0),
  importe_iva: z.coerce.number().default(0),
  importe_total: z.coerce.number().default(0),
  orden: z.coerce.number().int().default(0),
});

export const CreateSupplierInvoiceSchema = z.object({
  vendor_id: z.string().uuid("Seleccioná un proveedor válido"),
  cost_center_id: z.string().uuid().optional().nullable(),
  purchase_order_id: z.string().uuid().optional().nullable(),
  tipo_comprobante: z.enum(
    SUPPLIER_COMPROBANTE_VALUES as [string, ...string[]]
  ),
  punto_venta: z.coerce.number().int().min(0).max(99999),
  numero: z.string().trim().min(1, "El número de comprobante es obligatorio").max(20),
  cae: z.string().trim().max(20).optional().nullable(),
  fecha_emision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de emisión inválida"),
  fecha_vencimiento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de vencimiento inválida")
    .optional()
    .nullable(),
  moneda: z.string().trim().min(1).max(8).default("ARS"),
  importe_no_gravado: z.coerce.number().min(0).default(0),
  importe_exento: z.coerce.number().min(0).default(0),
  observ: z.string().trim().max(500).optional().nullable(),
  // ERP-B2 · detalle fiscal (fuente de verdad; el RPC reconcilia la cabecera)
  vat_lines: z.array(VatLineSchema).default([]),
  other_taxes: z.array(OtherTaxSchema).default([]),
  items: z.array(ItemSchema).default([]),
})
  // V4: una sola fila por alícuota (la tabla tiene unique)
  .refine(
    (d) => new Set(d.vat_lines.map((l) => l.alic_iva_id)).size === d.vat_lines.length,
    { message: "Hay renglones de IVA repetidos para la misma alícuota; consolidalos" }
  )
  // Debe haber al menos un componente fiscal
  .refine(
    (d) => d.vat_lines.length > 0 || d.other_taxes.length > 0 || d.importe_no_gravado > 0 || d.importe_exento > 0,
    { message: "Cargá al menos un renglón de IVA o un concepto no gravado/exento" }
  );
export type CreateSupplierInvoiceInput = z.infer<typeof CreateSupplierInvoiceSchema>;

export const CreateCostCenterSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "El código es obligatorio")
    .max(20)
    .regex(/^[A-Za-z0-9\-_]+$/, "Solo letras, números, guion y guion bajo"),
  name: z.string().trim().min(2, "El nombre es obligatorio").max(80),
  description: z.string().trim().max(300).optional().nullable(),
});
export type CreateCostCenterInput = z.infer<typeof CreateCostCenterSchema>;

// Etiquetas humanas por campo, para mensajes de validación entendibles por un
// usuario administrativo (en lugar del texto técnico crudo de Zod).
const FIELD_LABELS: Record<string, string> = {
  vendor_id: "Proveedor",
  cost_center_id: "Centro de costo",
  purchase_order_id: "Orden de compra",
  tipo_comprobante: "Tipo de comprobante",
  punto_venta: "Punto de venta",
  numero: "Número de comprobante",
  cae: "CAE",
  fecha_emision: "Fecha de emisión",
  fecha_vencimiento: "Fecha de vencimiento",
  importe_no_gravado: "Importe no gravado",
  importe_exento: "Importe exento",
  observ: "Observaciones",
  vat_lines: "Renglón de IVA",
  base_neto: "Neto gravado (renglón de IVA)",
  importe_iva: "IVA (renglón)",
  alicuota_iva: "Alícuota de IVA",
  alic_iva_id: "Alícuota de IVA",
  other_taxes: "Percepción / tributo",
  importe: "Importe (percepción/tributo)",
  base: "Base imponible (percepción/tributo)",
  alicuota: "Alícuota (percepción/tributo)",
  tax_kind: "Tipo de percepción/tributo",
  jurisdiction: "Jurisdicción",
  items: "Renglón de detalle",
  cantidad: "Cantidad (renglón)",
  precio_unitario: "Precio unitario (renglón)",
  descripcion: "Descripción (renglón)",
};

function humanizeIssue(i: z.ZodIssue): string {
  const lastKey = [...i.path].reverse().find((p) => typeof p === "string") as string | undefined;
  const rowIdx = i.path.find((p) => typeof p === "number");
  const label = (lastKey && FIELD_LABELS[lastKey]) || lastKey || "Dato de la factura";
  const fila = typeof rowIdx === "number" ? ` (fila ${rowIdx + 1})` : "";
  // Caso más común: un importe numérico llegó negativo y rompió .min(0).
  if (
    i.code === "too_small" &&
    (i as { type?: string }).type === "number" &&
    Number((i as { minimum?: number }).minimum) === 0
  ) {
    return `${label}${fila}: el valor no puede ser negativo. Revisá el importe.`;
  }
  return `${label}${fila}: ${i.message}`;
}

export function formatZodIssues(err: z.ZodError): string {
  return err.issues.map(humanizeIssue).join(" · ");
}
