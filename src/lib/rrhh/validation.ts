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

// CH1 — Alta de empleado (Capital Humano). Forma básica; autorización (rrhh.edit)
// e integridad (unicidad DNI/CUIL) las garantizan el guard + constraints de la base.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const empleadoCrearSchema = z.object({
  apellido_nombre: z.string().trim().min(2, "Apellido y nombre requerido").max(160),
  dni: z.string().trim().min(6, "DNI inválido").max(20),
  cuil: z.string().trim().min(8, "CUIL inválido").max(20),
  fecha_nacimiento: z.string().regex(ISO_DATE).optional().nullable().or(z.literal("")),
  domicilio: z.string().max(240).optional().nullable(),
  telefono: z.string().max(60).optional().nullable(),
  email_personal: z.string().email("Email inválido").max(160).optional().nullable().or(z.literal("")),
  estado_civil: z.enum(["soltero", "casado", "divorciado", "viudo", "union_convivencial", "otro"]).optional().nullable().or(z.literal("")),
  fecha_ingreso: z.string().regex(ISO_DATE, "Fecha de ingreso requerida"),
  fecha_reconocida: z.string().regex(ISO_DATE).optional().nullable().or(z.literal("")),
  categoria: z.string().max(120).optional().nullable(),
  seccion: z.string().max(120).optional().nullable(),
  convenio: z.string().max(120).optional().nullable(),
  modalidad_contratacion: z.enum(["tiempo_indeterminado", "tiempo_parcial", "director", "periodo_prueba", "plazo_fijo", "eventual", "temporada", "pasantia", "otro"]).optional().nullable().or(z.literal("")),
  depot: z.enum(["MAGALDI", "LUJAN"]).optional().nullable().or(z.literal("")),
  obra_social: z.string().max(120).optional().nullable(),
});
export type EmpleadoCrearInput = z.input<typeof empleadoCrearSchema>;

export const signedUrlSchema = z.object({
  document_id: z.string().uuid(),
  reason: z.string().max(500).optional().nullable(),
});
