import { env } from "@/lib/env";

/**
 * Transporte de emails de Órdenes de Servicio (Resend).
 *
 * Historial: las funciones legacy `sendOrderEmail` / `renderOrderHtml` /
 * `recipientsFor` / `whatsappLinkFor` / `mailtoFor` (esquema viejo de UN solo
 * correo con todos en copia) fueron eliminadas por código muerto (0 llamadores
 * verificados en src/, scripts/ y tests/). El flujo vigente es el de 4
 * notificaciones por rol: plan + render en `order-email.ts`, envío acá.
 */

/**
 * Envío genérico de UN email vía Resend (usado por el flujo de 4 notificaciones
 * diferenciadas por rol, ver order-email.ts). Si no hay RESEND_API_KEY devuelve
 * { skipped: true } en lugar de fallar: el envío queda DORMIDO en dev/staging
 * sin credenciales (no se dispara ningún correo real). La activación real la
 * controla Dirección cargando RESEND_API_KEY en producción.
 */
export async function sendOneOrderEmail(opts: {
  to: string;
  subject: string;
  html: string;
  /** Versión text/plain (fallback para clientes sin HTML / filtros antispam). */
  text?: string;
  /** Identidad durable derivada por PostgreSQL; nunca se genera al azar. */
  idempotencyKey: string;
}): Promise<{
  ok: boolean;
  id?: string;
  skipped?: boolean;
  ambiguous?: boolean;
  error?: string;
}> {
  if (!env.email.resendKey) {
    return { ok: true, skipped: true };
  }
  if (!/^[\x21-\x7e]{1,256}$/.test(opts.idempotencyKey)) {
    throw new Error("ORDER_EMAIL_IDEMPOTENCY_KEY_INVALID");
  }
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.email.resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": opts.idempotencyKey,
        },
        body: JSON.stringify({
          from: env.email.from,
          to: [opts.to],
          subject: opts.subject,
          html: opts.html,
          text: opts.text,
        }),
      });
    } catch {
      if (attempt === 0) continue;
      return { ok: false, ambiguous: true, error: "ORDER_EMAIL_NETWORK_AMBIGUOUS" };
    }
    if (res.ok || res.status < 500) break;
  }
  if (!res) {
    return { ok: false, ambiguous: true, error: "ORDER_EMAIL_NETWORK_AMBIGUOUS" };
  }
  if (!res.ok) {
    await res.text().catch(() => "");
    return { ok: false, error: "ORDER_EMAIL_PROVIDER_REJECTED" };
  }
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  if (!j.id || typeof j.id !== "string" || j.id.length > 200) {
    return { ok: false, ambiguous: true, error: "ORDER_EMAIL_PROVIDER_RESPONSE_INVALID" };
  }
  return { ok: true, id: j.id };
}
