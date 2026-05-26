import { z } from "zod";

/** Schema de validación para createOrder. */
export const CreateOrderSchema = z.object({
  client: z.object({
    id: z.string().nullable(),
    razon: z.string().min(2).max(200),
    cuit: z
      .string()
      .min(11)
      .max(15)
      .regex(/^[\d-]+$/, "CUIT inválido"),
    domicilio: z.string().max(300),
    telefono: z.string().max(40),
    contacto: z.string().max(120),
    email: z.string().email().or(z.literal("")),
  }),
  depot: z.enum(["MAGALDI", "LUJAN"]),
  operator_id: z.string().min(1),
  services: z
    .array(
      z.object({
        service_slug: z.string(),
        label: z.string(),
        qty: z.number().positive(),
        unit: z.string(),
        rate: z.number().nonnegative(),
        subtotal: z.number().nonnegative(),
      })
    )
    .min(1, "Seleccioná al menos un servicio"),
  h_start: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida"),
  h_end: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida"),
  pallets: z.number().int().nonnegative(),
  units: z.number().int().nonnegative(),
  km: z.number().int().nonnegative(),
  observ: z.string().max(2000),
  total: z.number().nonnegative(),
  signature: z.object({
    signed_by: z.string().min(2).max(120),
    signed_doc: z.string().max(40).nullable(),
    data_url: z.string().startsWith("data:image/png;base64,"),
    hash: z.string().length(64),
    geo_lat: z.number().nullable(),
    geo_lng: z.number().nullable(),
  }),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
