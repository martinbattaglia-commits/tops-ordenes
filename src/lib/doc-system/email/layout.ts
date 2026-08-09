/**
 * Doc-system · plantilla base de emails transaccionales TOPS.
 *
 * Shell HTML común para TODO email saliente del sistema (OS, OC, …):
 *   - Header banda navy con wordmark textual «LOGISTICA TOPS» (LOGISTICA en
 *     rojo, TOPS en blanco) + eyebrow de contexto por módulo.
 *   - Tarjeta blanca de 600px con el cuerpo específico del módulo.
 *   - Botón CTA rojo institucional.
 *   - Footer corporativo con los datos de `ORG` (fuente única de verdad).
 *
 * Reglas de compatibilidad con clientes de correo:
 *   - 100% estilos inline (sin <style>, sin clases).
 *   - Layout con tablas anidadas `role="presentation"`.
 *   - Sin recursos externos (ni imágenes, ni webfonts): el wordmark es texto.
 *
 * Colores: SIEMPRE desde los tokens del doc-system (`../tokens`). Imports
 * relativos a propósito: el módulo queda ejecutable con tsx/scripts sin
 * depender de la resolución del alias `@/`.
 */

import { DOC } from "../tokens";
import { ORG } from "../../org";

/** Stack sans de sistema (los emails no embeben webfonts). */
export const EMAIL_FONT_SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** Stack mono para identificadores duros (OS-000123, OC-2026-0001, CUIT…). */
export const EMAIL_FONT_MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,monospace";

/**
 * Escape HTML ÚNICO del sistema de emails. Escapa `& < > " '` — a diferencia
 * de los escapes históricos por módulo, cubre también la comilla simple.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Botón CTA rojo institucional (bulletproof: <a> con estilos inline). */
export function ctaButton(label: string, url: string): string {
  return (
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 0;">` +
    `<a href="${escapeHtml(url)}" style="display:inline-block;background:${DOC.red};color:${DOC.white};padding:12px 28px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;letter-spacing:0.04em;font-family:${EMAIL_FONT_SANS};">${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

export interface EmailShellOptions {
  /** Contexto del módulo (ej. «Coordinación operativa», «Orden de Compra»). */
  eyebrow: string;
  /** Identificador principal (ej. OS-000123). Se escapa acá. */
  title: string;
  /** Renderiza el título en mono (identificadores duros). Default: false. */
  titleMono?: boolean;
  /** Línea secundaria bajo el título (ej. sede del depósito). */
  subtitle?: string;
  /** Cuerpo específico del módulo. HTML YA construido/escapado por el caller. */
  bodyHtml: string;
  /** Botón CTA rojo (opcional). */
  cta?: { label: string; url: string };
  /** HTML opcional debajo del CTA (ej. link secundario al PDF). */
  belowCtaHtml?: string;
  /** Línea(s) extra ANTES del footer corporativo (ej. firmante de la OC). */
  footerExtraHtml?: string;
}

/**
 * Shell común de email transaccional. El caller aporta sólo el contenido del
 * módulo (`bodyHtml`); header, tarjeta, CTA y footer corporativo son comunes.
 */
export function renderEmailShell(o: EmailShellOptions): string {
  const titleFont = o.titleMono ? EMAIL_FONT_MONO : EMAIL_FONT_SANS;
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(o.title)}</title></head>
<body style="margin:0;padding:0;background:${DOC.bgSoft};color:${DOC.ink};font-family:${EMAIL_FONT_SANS};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${DOC.bgSoft};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:100%;">
      <tr><td style="background:${DOC.navy};padding:20px 24px;border-radius:10px 10px 0 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr><td style="font-family:${EMAIL_FONT_SANS};">
            <div style="font-size:15px;font-weight:900;letter-spacing:0.08em;"><span style="color:${DOC.red};">LOGISTICA</span>&nbsp;<span style="color:${DOC.white};">TOPS</span></div>
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${DOC.onNavySoft};margin-top:10px;">${escapeHtml(o.eyebrow)}</div>
            <div style="font-size:24px;font-weight:700;color:${DOC.white};margin-top:4px;font-family:${titleFont};">${escapeHtml(o.title)}</div>
            ${o.subtitle ? `<div style="font-size:13px;color:${DOC.onNavySoft};margin-top:2px;">${escapeHtml(o.subtitle)}</div>` : ""}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="background:${DOC.white};border:1px solid ${DOC.rule};border-top:none;border-radius:0 0 10px 10px;padding:24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr><td style="font-family:${EMAIL_FONT_SANS};font-size:15px;line-height:1.6;color:${DOC.ink};">
            ${o.bodyHtml}
            ${o.cta ? ctaButton(o.cta.label, o.cta.url) : ""}
            ${o.belowCtaHtml ?? ""}
          </td></tr>
          <tr><td style="padding-top:16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid ${DOC.ruleSoft};">
              <tr><td style="padding-top:16px;font-family:${EMAIL_FONT_SANS};font-size:12px;color:${DOC.label};line-height:1.5;">
                ${o.footerExtraHtml ? `${o.footerExtraHtml}<br>` : ""}
                ${escapeHtml(ORG.brand)} — ${escapeHtml(ORG.legalName)} · CUIT ${escapeHtml(ORG.cuit)} · IVA ${escapeHtml(ORG.iva)}<br>
                ${escapeHtml(ORG.address)} · Tel: ${escapeHtml(ORG.phone)}<br>
                <a href="https://${ORG.website}" style="color:${DOC.navy};">${ORG.website}</a>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Versión text/plain de un email. Une las líneas no vacías (los valores
 * falsy se descartan → permite líneas condicionales) y agrega SIEMPRE el
 * mismo footer corporativo de `ORG` que la versión HTML.
 */
export function textFallback(
  lines: Array<string | false | null | undefined>,
): string {
  const body = lines
    .filter((l): l is string => typeof l === "string")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return (
    `${body}\n\n---\n` +
    `${ORG.brand} — ${ORG.legalName} · CUIT ${ORG.cuit} · IVA ${ORG.iva}\n` +
    `${ORG.address} · Tel: ${ORG.phone}\n` +
    `https://${ORG.website}`
  );
}
