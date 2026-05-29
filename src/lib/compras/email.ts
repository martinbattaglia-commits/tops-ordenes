import { env } from "@/lib/env";
import { ORG } from "@/lib/org";
import { fmtCurrency, fmtDate } from "./format";
import type { POItem } from "@/lib/types-po";
import type { Totals } from "./totals";

interface SendInput {
  public_id: string;
  vendor: { razon: string; cuit: string; email: string; contacto: string };
  items: POItem[];
  totals: Totals;
  categoria: string;
  cond_pago: string;
  entrega: string;
  destino: string;
  observ: string;
}

/**
 * Envía el email transaccional al proveedor + admin + dirección.
 * Si Resend no está configurado, no-op para no romper el flujo en demo/local.
 * Reglas: siempre los 3 destinatarios (To proveedor; CC admin + emisor).
 */
export async function sendPurchaseOrderEmails(input: SendInput): Promise<void> {
  if (!env.email.resendKey) {
    console.info("[compras] RESEND_API_KEY missing — skipping email send", input.public_id);
    return;
  }

  const to = [input.vendor.email].filter(Boolean);
  const cc = [ORG.admin.email, ORG.emitter.email].filter(Boolean);
  if (to.length === 0) {
    console.warn("[compras] vendor sin email — no se puede enviar", input.public_id);
    return;
  }

  const subject = `Orden de Compra ${input.public_id} · ${ORG.brand}`;
  const html = renderEmailHtml(input);
  const text = renderEmailText(input);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.email.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.email.from,
      to,
      cc,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

function renderEmailHtml(input: SendInput): string {
  const itemsRows = input.items
    .map(
      (it) => `
    <tr>
      <td style="padding:6px 8px; font-size:13px; color:#0B1220;">${escapeHtml(it.label)}</td>
      <td align="right" style="padding:6px 8px; font-size:13px; color:#0B1220; font-variant-numeric:tabular-nums;">${it.qty} ${escapeHtml(it.unit)}</td>
      <td align="right" style="padding:6px 8px; font-size:13px; color:#050555; font-weight:700; font-variant-numeric:tabular-nums;">${escapeHtml(fmtCurrency(it.subtotal))}</td>
    </tr>`
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>OC ${input.public_id}</title></head>
<body style="margin:0; padding:0; background:#F7F8FB; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#0B1220;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 6px 18px rgba(5,5,85,0.10);">
      <tr><td style="background:#050555; padding:18px 22px;">
        <div style="font-size:22px; font-weight:900; color:#fff; letter-spacing:-0.5px;">TOPS <span style="color:#C90812; font-size:11px; letter-spacing:3px;">COMPRAS</span></div>
        <div style="font-size:11px; color:rgba(255,255,255,0.7); margin-top:2px;">${escapeHtml(ORG.legalName)} · CUIT ${escapeHtml(ORG.cuit)}</div>
      </td></tr>
      <tr><td style="padding:24px 22px 8px;">
        <div style="font-size:11px; font-weight:700; letter-spacing:2px; color:#C90812; text-transform:uppercase;">Orden de Compra</div>
        <div style="font-family:'SF Mono', Menlo, monospace; font-size:24px; font-weight:700; color:#050555; margin-top:4px;">${escapeHtml(input.public_id)}</div>
        <div style="font-size:13px; color:#5A6577; margin-top:2px;">${fmtDate(new Date())} · ${escapeHtml(input.categoria)}</div>
      </td></tr>
      <tr><td style="padding:0 22px 8px; font-size:14px; color:#0B1220; line-height:1.55;">
        Estimado/a <b>${escapeHtml(input.vendor.contacto || input.vendor.razon)}</b>,
        <p style="margin:10px 0 0;">Adjuntamos la orden de compra ${escapeHtml(input.public_id)} firmada por nuestro Director de Operaciones. Le solicitamos confirmación de recepción y coordinación de entrega.</p>
      </td></tr>
      <tr><td style="padding:14px 22px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F7F8FB; border-radius:8px;">
          <tr>
            <td style="padding:10px 14px;">
              <div style="font-size:10px; letter-spacing:1px; color:#8A94A6; text-transform:uppercase; font-weight:700;">Cond. pago</div>
              <div style="font-size:14px; font-weight:700; color:#050555;">${escapeHtml(input.cond_pago)}</div>
            </td>
            <td style="padding:10px 14px;">
              <div style="font-size:10px; letter-spacing:1px; color:#8A94A6; text-transform:uppercase; font-weight:700;">Entrega</div>
              <div style="font-size:14px; font-weight:700; color:#050555;">${escapeHtml(input.entrega)}</div>
            </td>
            <td style="padding:10px 14px;">
              <div style="font-size:10px; letter-spacing:1px; color:#8A94A6; text-transform:uppercase; font-weight:700;">Items</div>
              <div style="font-size:14px; font-weight:700; color:#050555; font-variant-numeric:tabular-nums;">${input.items.length}</div>
            </td>
            <td style="padding:10px 14px;">
              <div style="font-size:10px; letter-spacing:1px; color:#8A94A6; text-transform:uppercase; font-weight:700;">Total</div>
              <div style="font-size:14px; font-weight:700; color:#C90812; font-variant-numeric:tabular-nums;">${escapeHtml(fmtCurrency(input.totals.total))}</div>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 22px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #DDE3EC;">
          ${itemsRows}
        </table>
      </td></tr>
      <tr><td style="padding:18px 22px;">
        <a href="${env.app.url}/api/compras/${encodeURIComponent(input.public_id)}/pdf" style="display:inline-block; background:#C90812; color:#fff; font-weight:700; text-decoration:none; padding:12px 20px; border-radius:8px; font-size:14px;">Ver Orden de Compra (PDF) →</a>
      </td></tr>
      ${input.observ ? `<tr><td style="padding:0 22px 14px; font-size:13px; color:#5A6577; line-height:1.5;"><b>Observaciones:</b> ${escapeHtml(input.observ)}</td></tr>` : ""}
      <tr><td style="padding:18px 22px; background:#F7F8FB; font-size:11px; color:#8A94A6; line-height:1.55;">
        <b>${escapeHtml(ORG.emitter.name)}</b> · ${escapeHtml(ORG.emitter.role)}<br>
        ${escapeHtml(ORG.legalName)} · CUIT ${escapeHtml(ORG.cuit)}<br>
        ${escapeHtml(ORG.address)} · ${escapeHtml(ORG.phone)}<br>
        Este email fue enviado automáticamente por TOPS Compras.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function renderEmailText(input: SendInput): string {
  return `Orden de Compra ${input.public_id} - ${ORG.brand}

Estimado/a ${input.vendor.contacto || input.vendor.razon},

Adjuntamos la orden de compra firmada por nuestro Director de Operaciones.

Detalles:
- Fecha: ${fmtDate(new Date())}
- Cond. pago: ${input.cond_pago}
- Entrega: ${input.entrega}
- Items: ${input.items.length}
- Total: ${fmtCurrency(input.totals.total)}

PDF: ${env.app.url}/api/compras/${encodeURIComponent(input.public_id)}/pdf

${input.observ ? `Observaciones: ${input.observ}\n\n` : ""}---
${ORG.emitter.name} · ${ORG.emitter.role}
${ORG.legalName} · CUIT ${ORG.cuit}
${ORG.address}
${ORG.phone}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
