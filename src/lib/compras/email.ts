import { env } from "@/lib/env";
import { ORG } from "@/lib/org";
import { fmtCurrency, fmtDate } from "./format";
import type { POItem } from "@/lib/types-po";
import type { Totals } from "./totals";
import { PO_PRICE_STATE_LABEL } from "./pricing";
import {
  escapeHtml,
  renderEmailShell,
  textFallback,
  EMAIL_FONT_SANS,
} from "@/lib/doc-system/email/layout";
import { DOC } from "@/lib/doc-system/tokens";

interface SendInput {
  public_id: string;
  issuedAt: string;
  emitter: { name: string; email: string; role: string };
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
  idempotencyKey: string,
): Promise<SendPurchaseOrderEmailsResult> {
  const to = [input.vendor.email].filter(Boolean);
  const cc = [ORG.admin.email, input.emitter.email].filter(Boolean);

  if (!env.email.resendKey) {
    console.info("[compras] email send skipped", { code: "PO_EMAIL_NOT_CONFIGURED" });
    return { sent: false, providerId: null, skippedReason: "no_resend_key", to, cc };
  }
  if (to.length === 0) {
    console.warn("[compras] vendor sin email — no se puede enviar", {
      code: "PO_VENDOR_EMAIL_MISSING",
    });
    return { sent: false, providerId: null, skippedReason: "vendor_sin_email", to, cc };
  }
  if (!/^[\x21-\x7e]{1,256}$/.test(idempotencyKey)) {
    throw new Error("PO_EMAIL_IDEMPOTENCY_KEY_INVALID");
  }

  const subject = `Orden de Compra ${input.public_id} · ${ORG.brand}`;
  const html = renderEmailHtml(input);
  const text = renderEmailText(input);

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.email.resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
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
    } catch {
      if (attempt === 0) continue;
      throw new Error("PO_EMAIL_SEND_FAILED");
    }
    if (res.ok || (res.status < 500 && res.status !== 409)) break;
  }

  if (!res || !res.ok) {
    // Consumimos el body para cerrar correctamente la respuesta, pero jamás lo
    // propagamos: un proveedor puede incluir destinatarios u otros datos
    // personales en el error.
    if (res) await res.text().catch(() => "");
    throw new Error("PO_EMAIL_PROVIDER_REJECTED");
  }
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  if (!j.id || typeof j.id !== "string" || j.id.length > 200) {
    throw new Error("PO_EMAIL_PROVIDER_RESPONSE_INVALID");
  }
  return { sent: true, providerId: j.id, to, cc };
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
      <td align="right" style="padding:6px 8px;font-size:13px;color:${DOC.navy};font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(it.subtotal === null ? PO_PRICE_STATE_LABEL[it.price_state] : fmtCurrency(it.subtotal))}</td>
    </tr>`,
    )
    .join("");

  const bodyHtml = `
    <p style="margin:0 0 10px;font-size:14px;line-height:1.55;">Estimado/a <b>${escapeHtml(input.vendor.contacto || input.vendor.razon)}</b>,</p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;">Emitimos la orden de compra ${escapeHtml(input.public_id)}, firmada por ${escapeHtml(input.emitter.name)} (${escapeHtml(input.emitter.role)}). El documento firmado se entrega exclusivamente por un canal autorizado de TOPS. Le solicitamos confirmación de recepción y coordinación de entrega.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${DOC.bgSoft};border-radius:8px;">
      <tr>
        ${summaryCell("Cond. pago", escapeHtml(input.cond_pago))}
        ${summaryCell("Entrega", escapeHtml(input.entrega))}
        ${summaryCell("Items", `<span style="font-variant-numeric:tabular-nums;">${input.items.length}</span>`)}
        ${summaryCell(
          input.totals.state === "known" ? "Total" : input.totals.state === "estimated" ? "Total estimado" : "Importe",
          `<span style="color:${DOC.red};font-variant-numeric:tabular-nums;">${escapeHtml(
            input.totals.state === "pending" ? "Pendiente de precio" : fmtCurrency(input.totals.planningTotal),
          )}</span>`,
        )}
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
    subtitle: `${fmtDate(new Date(input.issuedAt))} · ${input.categoria}`,
    bodyHtml,
    footerExtraHtml: `<b>${escapeHtml(input.emitter.name)}</b> · ${escapeHtml(input.emitter.role)} — este email fue enviado automáticamente por TOPS Compras.`,
  });
}

/** Versión text/plain de la OC. Exportada para previews/tests. */
export function renderEmailText(input: SendInput): string {
  return textFallback([
    `Orden de Compra ${input.public_id} - ${ORG.brand}`,
    "",
    `Estimado/a ${input.vendor.contacto || input.vendor.razon},`,
    "",
    `Emitimos la orden de compra firmada por ${input.emitter.name} (${input.emitter.role}).`,
    "",
    "Detalles:",
    `- Fecha: ${fmtDate(new Date(input.issuedAt))}`,
    `- Cond. pago: ${input.cond_pago}`,
    `- Entrega: ${input.entrega}`,
    `- Items: ${input.items.length}`,
    `- ${input.totals.state === "known" ? "Total" : input.totals.state === "estimated" ? "Total estimado" : "Importe"}: ${
      input.totals.state === "pending" ? "Pendiente de precio" : fmtCurrency(input.totals.planningTotal)
    }`,
    "",
    "El documento firmado se entrega exclusivamente por un canal autorizado de TOPS.",
    "",
    input.observ ? `Observaciones: ${input.observ}` : false,
    input.observ ? "" : false,
    `${input.emitter.name} · ${input.emitter.role}`,
  ]);
}
