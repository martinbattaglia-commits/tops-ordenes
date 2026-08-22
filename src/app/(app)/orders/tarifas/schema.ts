import { z } from "zod";

export const ApprovalSchema = z.object({
  clientId: z.string().uuid("El ID de cliente es inválido"),
  serviceSlug: z.string().trim().min(2, "El servicio es requerido").max(160),
  currency: z.enum(["ARS", "USD"]),
  rate: z.coerce.number().positive("El precio debe ser mayor a 0"),
  minQty: z.union([z.literal(""), z.coerce.number().min(0)]).optional().nullable(),
  minBilling: z.union([z.literal(""), z.coerce.number().min(0)]).optional().nullable(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de vigencia inválida (formato AAAA-MM-DD)"),
  reason: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
});

export const ResetClientRateSchema = z.object({
  clientId: z.string().uuid("El ID de cliente es inválido"),
  serviceSlug: z.string().trim().min(2, "El servicio es requerido").max(160),
});

export type SaveClientRateInput = z.infer<typeof ApprovalSchema>;
