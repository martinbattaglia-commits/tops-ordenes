import { z } from "zod";
import { COMUNICADO_ICONS, COMUNICADO_PRIORITIES } from "./types";

export const AnnouncementInputSchema = z.object({
  title: z.string().trim().min(2, "El título es obligatorio").max(60, "Máximo 60 caracteres"),
  description: z.string().trim().max(160, "Máximo 160 caracteres").default(""),
  icon: z.enum(COMUNICADO_ICONS),
  priority: z.enum(COMUNICADO_PRIORITIES),
  active: z.boolean(),
  sort_order: z.number().int("El orden debe ser un entero").min(0).max(99),
});

export type AnnouncementInput = z.infer<typeof AnnouncementInputSchema>;
