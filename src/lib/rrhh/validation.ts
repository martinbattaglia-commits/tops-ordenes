/**
 * Validación de entrada RRHH (R6). La autorización y las reglas de negocio
 * viven en los RPC de la base (fail-closed); acá solo se valida forma básica.
 */
import { z } from "zod";

export const solicitudCrearSchema = z.object({
  empleado_id: z.string().uuid(),
  tipo: z.enum(["vacaciones", "permiso", "licencia", "hora_extra"]),
  subtipo: z.string().max(64).optional().nullable(),
  fecha_desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fecha_hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  motivo: z.string().max(2000).optional().nullable(),
  cantidad_dias: z.coerce.number().nonnegative().optional().nullable(),
});

export const solicitudIdSchema = z.object({
  id: z.string().uuid(),
  comentario: z.string().max(2000).optional().nullable(),
});

export const anularSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().min(1).max(2000),
});

export const signedUrlSchema = z.object({
  document_id: z.string().uuid(),
  reason: z.string().max(500).optional().nullable(),
});
