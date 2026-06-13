import { env } from "@/lib/env";
import type { Depot, Order } from "@/lib/types";

/**
 * Reglas de destinatarios según el handoff:
 *  - Siempre Ruth + José Luis (administración)
 *  - Magaldi → Juan Carlos
 *  - Luján → despachos
 *  - Si el cliente tiene email, también va en copia
 */
export function recipientsFor(order: Order, clientEmail?: string | null): string[] {
  const out = new Set<string>([env.email.admin.ruth, env.email.admin.joseluis]);
  if (order.depot === "MAGALDI") out.add(env.email.depot.magaldi);
  if (order.depot === "LUJAN") out.add(env.email.depot.lujan);
  if (clientEmail) out.add(clientEmail);
  return Array.from(out).filter(Boolean);
}

export function whatsappLinkFor(order: Order, publicUrl: string): string {
  const text = encodeURIComponent(
    `Comprobante TOPS Órdenes — ${order.public_id}\nCliente: ${order.client?.razon ?? ""}\n${publicUrl}`
  );
  return `https://wa.me/?text=${text}`;
}

export function mailtoFor(order: Order, publicUrl: string, to?: string): string {
  const subject = encodeURIComponent(`Comprobante TOPS — ${order.public_id}`);
  const body = encodeURIComponent(
    `Le adjuntamos el comprobante de servicio ${order.public_id}.\n\nVer online: ${publicUrl}\n\n— Logística TOPS (Verotin S.A.)`
  );
  return `mailto:${to ?? ""}?subject=${subject}&body=${body}`;
}

/**
 * Envío real con Resend. Si no hay API key, devuelve `skipped` en lugar
 * de fallar — útil para entornos staging sin credenciales.
 */
export async function sendOrderEmail(opts: {
  order: Order;
  to: string[];
  pdfUrl?: string;
  publicUrl: string;
}): Promise<{ ok: boolean; id?: string; skipped?: boolean; error?: string }> {
  if (!env.email.resendKey) {
    return { ok: true, skipped: true };
  }
  const html = renderOrderHtml(opts.order, opts.publicUrl, opts.pdfUrl);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.email.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.email.from,
      to: opts.to,
      subject: `Comprobante TOPS — ${opts.order.public_id} · ${opts.order.client?.razon ?? ""}`,
      html,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, error: errText || `HTTP ${res.status}` };
  }
  const j = (await res.json()) as { id?: string };
  return { ok: true, id: j.id };
}

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
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, error: errText || `HTTP ${res.status}` };
  }
  const j = (await res.json()) as { id?: string };
  return { ok: true, id: j.id };
}

function renderOrderHtml(order: Order, publicUrl: string, pdfUrl?: string): string {
  const depotLabel: Record<Depot, string> = { MAGALDI: "Magaldi · CABA", LUJAN: "Luján · BsAs" };
  const total = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(order.total);

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${order.public_id}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f7f8fb;color:#0b1220;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#050555;color:white;padding:20px 24px;border-radius:10px 10px 0 0;">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;opacity:0.7;">Comprobante de servicio</div>
      <div style="font-size:24px;font-weight:700;margin-top:4px;">${order.public_id}</div>
      <div style="font-size:13px;opacity:0.85;margin-top:2px;">${depotLabel[order.depot]}</div>
    </div>
    <div style="background:white;border:1px solid #dde3ec;border-top:none;padding:24px;border-radius:0 0 10px 10px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        Estimado/a, le adjuntamos el comprobante de la orden de servicio
        <strong>${order.public_id}</strong> realizada para
        <strong>${order.client?.razon ?? ""}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#5a6577;">Fecha</td><td style="padding:8px 0;text-align:right;font-weight:600;">${new Date(order.date).toLocaleDateString("es-AR")}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6577;border-top:1px solid #eef1f6;">Depósito</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6;">${depotLabel[order.depot]}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6577;border-top:1px solid #eef1f6;">Total estimado</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #eef1f6;color:#050555;font-size:16px;">${total} + IVA</td></tr>
      </table>
      <div style="text-align:center;margin:24px 0;">
        <a href="${publicUrl}" style="display:inline-block;background:#C90812;color:white;padding:12px 28px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;letter-spacing:0.04em;">Ver comprobante online →</a>
      </div>
      ${pdfUrl ? `<p style="margin:16px 0 0;font-size:13px;color:#5a6577;text-align:center;">PDF adjunto: <a href="${pdfUrl}" style="color:#214576;">Descargar comprobante</a></p>` : ""}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eef1f6;font-size:12px;color:#8a94a6;line-height:1.5;">
        Logística TOPS — Verotin S.A. · IVA Responsable Inscripto<br>
        Agustín Magaldi 1765 — CABA · Tel/Fax: 4302-3944<br>
        <a href="https://www.logisticatops.com" style="color:#214576;">www.logisticatops.com</a>
      </div>
    </div>
  </div>
</body></html>`;
}
