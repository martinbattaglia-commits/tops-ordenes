import { z } from "zod";
import { SUPPLIER_COMPROBANTE_VALUES } from "./types";

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
  neto: z.coerce.number().min(0),
  iva: z.coerce.number().min(0),
  percepciones: z.coerce.number().min(0).default(0),
  observ: z.string().trim().max(500).optional().nullable(),
});
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

export function formatZodIssues(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join(" · ");
}
