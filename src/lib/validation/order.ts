import { z } from "zod";

/**
 * Schema de validación para createOrder.
 *
 * Usa `z.coerce.number()` en los campos numéricos que vienen de inputs HTML
 * (donde `e.target.value` es string y puede llegar como "0", "", NaN, etc.).
 * Esto evita falsos negativos por type-mismatch.
 */
export const CreateOrderSchema = z.object({
  client: z.object({
    id: z.string().nullable(),
    razon: z.string().min(2, "Razón social muy corta").max(200),
    cuit: z
      .string()
      .min(11, "CUIT incompleto")
      .max(15)
      .regex(/^[\d-]+$/, "CUIT con formato inválido"),
    domicilio: z.string().max(300),
    telefono: z.string().max(40),
    contacto: z.string().max(120),
    email: z.string().email("Email inválido").or(z.literal("")),
  }),
  depot: z.enum(["MAGALDI", "LUJAN"], {
    errorMap: () => ({ message: "Depósito inválido" }),
  }),
  operator_id: z.string().min(1, "Seleccioná un responsable operativo"),
  services: z
    .array(
      z.object({
        service_slug: z.string(),
        label: z.string(),
        qty: z.coerce.number().positive("Cantidad debe ser mayor a 0"),
        unit: z.string(),
        rate: z.coerce.number().nonnegative("Tarifa inválida"),
        subtotal: z.coerce.number().nonnegative("Subtotal inválido"),
      })
    )
    .min(1, "Seleccioná al menos un servicio"),
  h_start: z.string().regex(/^\d{2}:\d{2}$/, "Hora inicio inválida"),
  h_end: z.string().regex(/^\d{2}:\d{2}$/, "Hora fin inválida"),
  pallets: z.coerce.number().int("Pallets debe ser entero").nonnegative("Pallets debe ser ≥ 0"),
  units: z.coerce.number().int("Unidades debe ser entero").nonnegative("Unidades debe ser ≥ 0"),
  km: z.coerce.number().int("Km debe ser entero").nonnegative("Km debe ser ≥ 0"),
  observ: z.string().max(2000),
  total: z.coerce.number().nonnegative("Total inválido"),
  signature: z.object({
    signed_by: z.string().min(2, "Nombre del firmante muy corto").max(120),
    signed_doc: z.string().max(40).nullable(),
    data_url: z
      .string()
      .startsWith("data:image/png;base64,", "Firma no capturada correctamente"),
    hash: z.string().length(64, "Hash de firma inválido"),
    geo_lat: z.number().nullable(),
    geo_lng: z.number().nullable(),
  }),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

/**
 * Formatea los issues de un ZodError en un mensaje legible que incluye
 * el path del campo (ej: "client.razon: muy corta").
 */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") : "input";
      return `${path}: ${i.message}`;
    })
    .join(" · ");
}
