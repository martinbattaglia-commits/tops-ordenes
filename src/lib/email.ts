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
}): Promise<{ ok: boolean; id?: string; skipped?: boolean; error?: string }> {
  if (!env.email.resendKey) {
    return { ok: true, skipped: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.email.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.email.from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, error: errText || `HTTP ${res.status}` };
  }
  const j = (await res.json()) as { id?: string };
  return { ok: true, id: j.id };
}
