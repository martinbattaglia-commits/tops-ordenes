/**
 * humanizeCajaError — traduce los códigos de las RPC `caja_chica_*` a texto
 * legible. Caja Chica encapsula sus propios mensajes (módulo independiente) y
 * delega en el humanizador del motor de Tesorería lo que ya está resuelto ahí
 * (FORBIDDEN, INVALID_AMOUNT, CURRENCY_UNSUPPORTED, VOID_REQUIRES_REASON…).
 * No agrega lógica: sólo mapeo.
 */
import { humanizeRpcError } from "../errors";

export function humanizeCajaError(message = ""): string {
  const m = message || "";
  if (m.includes("CAJA_CONCEPT_REQUIRED")) return "El concepto es obligatorio.";
  if (m.includes("CAJA_DIRECTION_INVALID")) return "Indicá si el movimiento es un ingreso o un egreso.";
  if (m.includes("CAJA_RESPONSABLE_REQUIRED")) return "Indicá el responsable del movimiento.";
  if (m.includes("CAJA_RESPONSABLE_INVALID")) return "El responsable seleccionado no existe o está inactivo.";
  if (m.includes("CAJA_ACCOUNT_NOT_FOUND")) return "No hay una cuenta de Caja activa configurada en Tesorería.";
  if (m.includes("NO_AUTH_CONTEXT")) return "La sesión no es válida. Volvé a iniciar sesión.";
  return humanizeRpcError(m);
}
