/**
 * email-failure.ts — F4.4-E3 · Fin del silent failure del email transaccional.
 *
 * Hallazgo F4.4 (verificación 2026-07-02): `email_sends` acumulaba 56/56 filas
 * `failed` (Resend 403 testing-mode: dominio sin verificar) y NADIE se enteró —
 * los 4 correos por rol de una OS no llegaban desde siempre. La reparación del
 * dominio es acción de Dirección (D-F44-4/D-F44-6 histórica); este módulo
 * agrega la VISIBILIDAD: cada envío fallido genera una notificación interna al
 * rol admin (campana + Centro), enlazada a la orden.
 *
 * PII (D-F44-7): el aviso NO incluye la dirección de email ni el cuerpo del
 * mail — solo public_id de la orden, el rol destinatario (tag) y el error del
 * proveedor recortado.
 *
 * Puro y testeable; el insert lo hace el caller (best-effort, nunca rompe la orden).
 */

export interface EmailFailureNotificationInput {
  /** uuid de la orden (entity_id → la campana navega a /orders/<id>). */
  orderId: string;
  /** public_id legible (OS-2026-XXXX); si falta se usa el uuid. */
  publicId: string | null;
  /** Rol destinatario del mail fallido (tag de email_sends: cliente/depot/…). */
  tag: string;
  /** Error del proveedor (se recorta; sin secrets — Resend no los incluye). */
  providerError?: string | null;
}

export interface NotificationRow {
  role_target: "admin";
  kind: string;
  title: string;
  message: string;
  entity: string;
  entity_id: string;
  priority?: string;
}

const MAX_ERROR_LEN = 140;

/** Fila de `notifications` (broadcast a admin) para un email de orden fallido. */
export function emailFailureNotification(p: EmailFailureNotificationInput): NotificationRow {
  const orden = p.publicId?.trim() || p.orderId;
  const err = (p.providerError ?? "").replace(/\s+/g, " ").trim();
  const detalle = err ? ` — ${err.slice(0, MAX_ERROR_LEN)}${err.length > MAX_ERROR_LEN ? "…" : ""}` : "";
  return {
    role_target: "admin",
    kind: "info",
    title: "Email de orden FALLÓ",
    message: `${orden} · destinatario '${p.tag}' no recibió el correo${detalle}. Revisar configuración Resend (dominio).`,
    entity: "orders",
    entity_id: p.orderId,
  };
}
