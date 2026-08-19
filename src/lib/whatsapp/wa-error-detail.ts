/**
 * El DETALLE que Meta manda con cada fallo, y que el sistema estaba borrando.
 *
 * `parseInboundPayload` tomaba `errors[0]` y conservaba únicamente `code`. El
 * código es genérico por diseño: 131053 es «Media upload error» para cualquier
 * causa. El texto que lo vuelve accionable viaja en `error_data.details`, y ahí
 * estaba, guardado en `wa_inbound_events` desde el 2026-08-17:
 *
 *   «Audio file uploaded with mimetype as audio/mp4, however on processing it
 *    is of type application/octet-stream. Please choose a different file.»
 *
 * Ese texto ERA la causa raíz. Costó dos hipótesis erradas y bajar el binario de
 * producción llegar a lo que el proveedor ya había dicho dos días antes. Es el
 * cuarto sitio de este programa donde el error real se destruye y se reemplaza
 * por un identificador que no distingue nada.
 *
 * Módulo puro, sin IO.
 */

/** Lo que Meta pone en `statuses[].errors[]`. Todo opcional salvo el código. */
interface WaProviderError {
  code?: unknown;
  title?: unknown;
  message?: unknown;
  error_data?: unknown;
}

/**
 * Tope del texto conservado. Es un diagnóstico, no un volcado: la columna se
 * consulta a mano y un mensaje del proveedor no debería poder inflarla.
 */
const MAX_LARGO = 500;

/**
 * Redacción de teléfonos.
 *
 * Que Meta no haya mandado nunca un número dentro de `details` no es garantía
 * de que no lo haga: el texto lo redacta un tercero, la columna es consultable
 * y el evento del que sale contiene datos de la contraparte. Se redacta la
 * FORMA, no un número concreto.
 */
const TELEFONO = /\+?\d[\d\s().-]{7,}\d/g;

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function sanear(bruto: string): string {
  const sinTelefonos = bruto.replace(TELEFONO, "[tel]");
  return sinTelefonos.length > MAX_LARGO
    ? `${sinTelefonos.slice(0, MAX_LARGO - 1)}…`
    : sinTelefonos;
}

/**
 * Extrae el texto más específico disponible del primer error.
 *
 * Orden deliberado: `error_data.details` es lo único que distingue una causa de
 * otra dentro del mismo código; `title` y `message` suelen repetir el nombre de
 * la familia. `null` cuando no hay nada — jamás una cadena inventada, que sería
 * el mismo defecto en otra forma.
 */
export function extractWaErrorDetail(errors: unknown): string | null {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const primero = errors[0];
  if (!primero || typeof primero !== "object") return null;
  const e = primero as WaProviderError;

  const data = e.error_data && typeof e.error_data === "object"
    ? (e.error_data as { details?: unknown })
    : null;

  const elegido = texto(data?.details) ?? texto(e.title) ?? texto(e.message);
  return elegido ? sanear(elegido) : null;
}
