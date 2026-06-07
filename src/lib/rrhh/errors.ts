/**
 * Catálogo de errores RRHH (R6). Mapea los errcodes/errores de los RPC de R4/R5
 * a mensajes legibles para la UI. No expone PII ni detalles internos sensibles.
 */

export interface RrhhActionResult {
  ok: boolean;
  message: string;
}

export function mapRrhhError(err: unknown): RrhhActionResult {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  // Errores de los RPC (raise exception ... using errcode).
  if (/ACCESS_DENIED/i.test(raw)) return { ok: false, message: "No tenés permiso para esta acción." };
  if (/INVALID_STATE/i.test(raw)) return { ok: false, message: "La solicitud no está en un estado válido para esta acción." };
  if (/MOTIVO_REQUIRED/i.test(raw)) return { ok: false, message: "Se requiere un motivo." };
  if (/INVALID_RANGE/i.test(raw)) return { ok: false, message: "El rango de fechas es inválido." };
  if (/INVALID_HE/i.test(raw)) return { ok: false, message: "Horas extra requiere cantidad de horas y recargo." };
  if (/NOT_FOUND/i.test(raw)) return { ok: false, message: "No encontrado." };
  if (/REDACTED/i.test(raw)) return { ok: false, message: "El documento fue suprimido y no es accesible." };
  return { ok: false, message: "No se pudo completar la operación." };
}
