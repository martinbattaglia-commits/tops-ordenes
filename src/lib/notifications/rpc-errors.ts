/**
 * Traducción de los errores de las RPC de notificaciones (0162 / 0235) a
 * mensajes accionables para el operador.
 *
 * Vive en un módulo PURO —sin `"use server"`— a propósito: la campanita es un
 * componente de cliente y también necesita nombrar la causa. Mientras esto
 * estuvo dentro de `actions.ts`, el cliente no podía importarlo y terminaba
 * mostrando un genérico "reintentá en unos segundos" incluso ante
 * `sesión no autenticada`, donde reintentar no puede funcionar nunca.
 */

/** Traduce errores Postgres de las RPCs 0162/0235 (lección DEFECT-4). */
export function mapNotifRpcError(message: string): string {
  if (/inexistente/.test(message)) return "La notificación ya no existe.";
  if (/no está dirigida a este usuario/.test(message)) {
    return "Esa notificación no está dirigida a vos.";
  }
  if (/sesión no autenticada/.test(message)) {
    return "Tu sesión venció. Volvé a iniciar sesión.";
  }
  if (/dueño o el delegado|insufficient_privilege/i.test(message)) {
    return "Solo el dueño o el delegado pueden accionar esta notificación.";
  }
  if (/snooze inválido/.test(message)) return "El recordatorio debe ser entre 1 minuto y 30 días.";
  if (/destinatario no es un usuario interno/.test(message)) {
    return "Elegí un usuario interno válido para delegar.";
  }
  if (/prioridad inválida/.test(message)) return "Prioridad inválida.";
  return message;
}
