/**
 * Esquemas zod del módulo Caja Chica (CCN-001B · F3). Validan SOLO forma/tipos.
 * Las reglas de negocio (permiso, cuenta caja, importe > 0, responsable válido,
 * transición de anulación) viven en las RPC `caja_chica_*` — NO se duplican acá.
 *
 * Importes como STRING decimal (máx 2 decimales), igual que el resto de
 * Tesorería, para evitar imprecisión de punto flotante.
 */
import { z } from "zod";

const MONEY = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido (hasta 2 decimales)");
const UUID = z.string().uuid("Identificador inválido");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)");

export const RegistrarCajaMovimientoSchema = z.object({
  date: DATE,
  direction: z.enum(["ingreso", "egreso"]),
  amount: MONEY,
  concept: z.string().trim().min(1, "El concepto es obligatorio").max(200),
  responsable_id: UUID,
  observations: z.string().trim().max(500).optional().nullable(),
});
export type RegistrarCajaMovimientoInput = z.infer<typeof RegistrarCajaMovimientoSchema>;

export const AnularCajaMovimientoSchema = z.object({
  movement_id: UUID,
  reason: z.string().trim().min(1, "El motivo de la anulación es obligatorio").max(300),
});
export type AnularCajaMovimientoInput = z.infer<typeof AnularCajaMovimientoSchema>;
