import { env } from "@/lib/env";
import { ORG } from "@/lib/org";
import { fmtCurrency, fmtDate } from "./format";
import type { POItem } from "@/lib/types-po";
import type { Totals } from "./totals";
import {
  escapeHtml,
  renderEmailShell,
  textFallback,
  EMAIL_FONT_SANS,
} from "@/lib/doc-system/email/layout";
import { DOC } from "@/lib/doc-system/tokens";

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

/** Resultado del envío — permite al caller auditar en `po_email_sends`. */
export interface SendPurchaseOrderEmailsResult {
  sent: boolean;
  providerId: string | null;
  /** Motivo cuando no hubo envío real. */
  skippedReason?: "no_resend_key" | "vendor_sin_email";
  to: string[];
  cc: string[];
}

/**
 * Envía el email transaccional al proveedor + admin + dirección.
 * Si Resend no está configurado, no-op para no romper el flujo en demo/local.
 * Reglas: siempre los 3 destinatarios (To proveedor; CC admin + emisor).
 */
export async function sendPurchaseOrderEmails(
  input: SendInput,
): Promise<SendPurchaseOrderEmailsResult> {
  const to = [input.vendor.email].filter(Boolean);
  const cc = [ORG.admin.email, ORG.emitter.email].filter(Boolean);

  if (!env.email.resendKey) {
    console.info("[compras] RESEND_API_KEY missing — skipping email send", input.public_id);
    return { sent: false, providerId: null, skippedReason: "no_resend_key", to, cc };
  }
  if (to.length === 0) {
    console.warn("[compras] vendor sin email — no se puede enviar", input.public_id);
    return { sent: false, providerId: null, skippedReason: "vendor_sin_email", to, cc };
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
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  return { sent: true, providerId: j.id ?? null, to, cc };
}

/** Celda del resumen (Cond. pago / Entrega / Items / Total). */
function summaryCell(label: string, valueHtml: string): string {
  return (
    `<td style="padding:10px 14px;font-family:${EMAIL_FONT_SANS};">` +
    `<div style="font-size:10px;letter-spacing:1px;color:${DOC.labelSoft};text-transform:uppercase;font-weight:700;">${label}</div>` +
    `<div style="font-size:14px;font-weight:700;color:${DOC.navy};">${valueHtml}</div>` +
    `</td>`
  );
}

/** Render HTML de la OC sobre la plantilla base del doc-system. Exportado para previews/tests. */
export function renderEmailHtml(input: SendInput): string {
  const itemsRows = input.items
    .map(
      (it) => `
    <tr>
      <td style="padding:6px 8px;font-size:13px;color:${DOC.ink};">${escapeHtml(it.label)}</td>
      <td align="right" style="padding:6px 8px;font-size:13px;color:${DOC.ink};font-variant-numeric:tabular-nums;">${it.qty} ${escapeHtml(it.unit)}</td>
      <td align="right" style="padding:6px 8px;font-size:13px;color:${DOC.navy};font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(fmtCurrency(it.subtotal))}</td>
    </tr>`,
    )
    .join("");

  const pdfUrl = `${env.app.url}/api/compras/${encodeURIComponent(input.public_id)}/pdf`;

  const bodyHtml = `
    <p style="margin:0 0 10px;font-size:14px;line-height:1.55;">Estimado/a <b>${escapeHtml(input.vendor.contacto || input.vendor.razon)}</b>,</p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;">Adjuntamos la orden de compra ${escapeHtml(input.public_id)} firmada por nuestro ${escapeHtml(ORG.emitter.role)}. Le solicitamos confirmación de recepción y coordinación de entrega.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${DOC.bgSoft};border-radius:8px;">
      <tr>
        ${summaryCell("Cond. pago", escapeHtml(input.cond_pago))}
        ${summaryCell("Entrega", escapeHtml(input.entrega))}
        ${summaryCell("Items", `<span style="font-variant-numeric:tabular-nums;">${input.items.length}</span>`)}
        ${summaryCell("Total", `<span style="color:${DOC.red};font-variant-numeric:tabular-nums;">${escapeHtml(fmtCurrency(input.totals.total))}</span>`)}
      </tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid ${DOC.rule};margin-top:14px;">
      ${itemsRows}
    </table>
    ${input.observ ? `<p style="margin:14px 0 0;font-size:13px;color:${DOC.textSec};line-height:1.5;"><b>Observaciones:</b> ${escapeHtml(input.observ)}</p>` : ""}`;

  return renderEmailShell({
    eyebrow: "Compras · Orden de Compra",
    title: input.public_id,
    titleMono: true,
    subtitle: `${fmtDate(new Date())} · ${input.categoria}`,
    bodyHtml,
    cta: { label: "Ver Orden de Compra (PDF) →", url: pdfUrl },
    footerExtraHtml: `<b>${escapeHtml(ORG.emitter.name)}</b> · ${escapeHtml(ORG.emitter.role)} — este email fue enviado automáticamente por TOPS Compras.`,
  });
}

/** Versión text/plain de la OC. Exportada para previews/tests. */
export function renderEmailText(input: SendInput): string {
  return textFallback([
    `Orden de Compra ${input.public_id} - ${ORG.brand}`,
    "",
    `Estimado/a ${input.vendor.contacto || input.vendor.razon},`,
    "",
    `Adjuntamos la orden de compra firmada por nuestro ${ORG.emitter.role}.`,
    "",
    "Detalles:",
    `- Fecha: ${fmtDate(new Date())}`,
    `- Cond. pago: ${input.cond_pago}`,
    `- Entrega: ${input.entrega}`,
    `- Items: ${input.items.length}`,
    `- Total: ${fmtCurrency(input.totals.total)}`,
    "",
    `PDF: ${env.app.url}/api/compras/${encodeURIComponent(input.public_id)}/pdf`,
    "",
    input.observ ? `Observaciones: ${input.observ}` : false,
    input.observ ? "" : false,
    `${ORG.emitter.name} · ${ORG.emitter.role}`,
  ]);
}
