/**
 * Lógica PURA de notificaciones automáticas de Orden de Servicio.
 *
 * Separada de `email.ts` (que hace la llamada real a Resend) para que el plan
 * de destinatarios, el contenido por rol y la deduplicación sean testeables
 * sin DB ni red. Sólo importa TIPOS (se borran en compilación), por lo que no
 * arrastra dependencias de runtime.
 *
 * Reglas de negocio (handoff Dirección):
 *   Toda OS generada dispara 4 correos diferenciados por rol:
 *     1) DEPÓSITO    — según sede (Magaldi / Luján): coordinación operativa.
 *     2) DIRECTOR    — joseluis@: control y supervisión.
 *     3) FACTURACIÓN — ruth@: seguimiento administrativo / facturación.
 *     4) CLIENTE     — email de la ficha: comprobante.
 *   Una vez por orden, sin duplicados, con auditoría en `email_sends`.
 */

import type { Depot, Order } from "@/lib/types";

export type OrderEmailRole = "deposito" | "director" | "facturacion" | "cliente";

/** Direcciones resueltas desde `env.email` (inyectadas para mantener pureza). */
export interface OrderEmailAddresses {
  depotMagaldi: string;
  depotLujan: string;
  director: string;
  facturacion: string;
}

export interface OrderEmailItem {
  role: OrderEmailRole;
  to: string;
  /** Etiqueta estable persistida en email_sends.tag (clave de deduplicación). */
  tag: string;
  subject: string;
}

const DEPOT_LABEL: Record<Depot, string> = {
  MAGALDI: "Magaldi · CABA",
  LUJAN: "Luján · BsAs",
};

const ROLE_TAG: Record<OrderEmailRole, string> = {
  deposito: "depot",
  director: "director",
  facturacion: "facturacion",
  cliente: "cliente",
};

/** Email del depósito según la sede de la orden. */
function depotEmail(depot: Depot, addr: OrderEmailAddresses): string {
  return depot === "MAGALDI" ? addr.depotMagaldi : addr.depotLujan;
}

/**
 * Construye el plan de envío: los destinatarios diferenciados por rol para una
 * orden. El cliente sólo se incluye si tiene email. Determinístico y puro.
 */
export function orderEmailPlan(
  order: Order,
  clientEmail: string | null | undefined,
  addr: OrderEmailAddresses,
): OrderEmailItem[] {
  const pid = order.public_id;
  const razon = order.client?.razon ?? "";
  const items: OrderEmailItem[] = [
    {
      role: "deposito",
      to: depotEmail(order.depot, addr),
      tag: ROLE_TAG.deposito,
      subject: `🚚 Despacho ${pid} · ${DEPOT_LABEL[order.depot]} · ${razon}`,
    },
    {
      role: "director",
      to: addr.director,
      tag: ROLE_TAG.director,
      subject: `OS ${pid} · ${razon} · supervisión operativa`,
    },
    {
      role: "facturacion",
      to: addr.facturacion,
      tag: ROLE_TAG.facturacion,
      subject: `OS ${pid} · ${razon} · administración / facturación`,
    },
  ];
  const clientTo = (clientEmail ?? "").trim();
  if (clientTo) {
    items.push({
      role: "cliente",
      to: clientTo,
      tag: ROLE_TAG.cliente,
      subject: `Comprobante TOPS — ${pid}`,
    });
  }
  return items;
}

/**
 * Deduplicación: descarta los items cuyo `tag` ya figura como enviado para la
 * orden (set provisto por el caller desde email_sends). Garantiza "una sola vez
 * por orden y por rol".
 */
export function dedupeOrderEmails(
  plan: OrderEmailItem[],
  alreadySentTags: Set<string>,
): OrderEmailItem[] {
  return plan.filter((item) => !alreadySentTags.has(item.tag));
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-AR");
  } catch {
    return iso;
  }
}

function servicesRows(order: Order): string {
  const svcs = order.services ?? [];
  if (svcs.length === 0) {
    return `<tr><td colspan="2" style="padding:8px 0;color:#5a6577;">Sin servicios detallados.</td></tr>`;
  }
  return svcs
    .map(
      (s) =>
        `<tr><td style="padding:6px 0;border-top:1px solid #eef1f6;">${escapeHtml(s.label)} <span style="color:#8a94a6;">· ${s.qty} ${escapeHtml(String(s.unit))}</span></td><td style="padding:6px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6;">${fmtMoney(s.subtotal)}</td></tr>`,
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Filas de totales discriminados (Subtotal neto / IVA 21% / Total). order.total
 * es NETO; el IVA se estima al 21% (misma fórmula que ivaEstimate). La
 * facturación fiscal real corre por el módulo de Facturación/ARCA.
 */
function totalsRows(order: Order): string {
  const iva = Math.round(order.total * 0.21);
  const total = order.total + iva;
  return (
    `<tr><td style="padding:8px 0;border-top:2px solid #050555;color:#5a6577;">Subtotal neto</td>` +
    `<td style="padding:8px 0;text-align:right;border-top:2px solid #050555;">${fmtMoney(order.total)}</td></tr>` +
    `<tr><td style="padding:4px 0;color:#5a6577;">IVA (21%)</td>` +
    `<td style="padding:4px 0;text-align:right;">${fmtMoney(iva)}</td></tr>` +
    `<tr><td style="padding:6px 0;font-weight:700;border-top:1px solid #eef1f6;">Total</td>` +
    `<td style="padding:6px 0;text-align:right;font-weight:700;color:#050555;">${fmtMoney(total)}</td></tr>`
  );
}

/** Texto-objetivo por rol (encabeza el cuerpo del email). */
const ROLE_INTRO: Record<OrderEmailRole, { eyebrow: string; objetivo: string }> = {
  deposito: {
    eyebrow: "Coordinación operativa",
    objetivo: "Coordinar la ejecución del despacho. Datos operativos, responsable y horario abajo.",
  },
  director: {
    eyebrow: "Control y supervisión",
    objetivo: "Control operativo y supervisión. Datos completos, servicios y responsable asignado.",
  },
  facturacion: {
    eyebrow: "Administración / facturación",
    objetivo: "Seguimiento administrativo y posterior facturación. Cliente, servicios, importe y fecha.",
  },
  cliente: {
    eyebrow: "Comprobante de servicio",
    objetivo: "Le adjuntamos el comprobante de la orden de servicio realizada.",
  },
};

/**
 * Render del cuerpo HTML del email, diferenciado por rol. Puro (no toca env ni
 * red). El bloque central varía según el destinatario; la cabecera, CTA y pie
 * son comunes.
 */
export function renderRoleHtml(
  order: Order,
  role: OrderEmailRole,
  publicUrl: string,
  pdfUrl?: string,
  urgent = false,
): string {
  const pid = order.public_id;
  const razon = order.client?.razon ?? "";
  const intro = ROLE_INTRO[role];
  const horario =
    order.h_start && order.h_end ? `${order.h_start} – ${order.h_end}` : "—";
  const responsable = order.operator?.full_name ?? "—";

  // Bloque central por rol.
  let middle = "";
  if (role === "deposito") {
    middle = `
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#5a6577;">Cliente</td><td style="padding:8px 0;text-align:right;font-weight:600;">${escapeHtml(razon)}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6577;border-top:1px solid #eef1f6;">Depósito</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6;">${DEPOT_LABEL[order.depot]}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6577;border-top:1px solid #eef1f6;">Horario</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6;">${horario}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6577;border-top:1px solid #eef1f6;">Responsable operativo</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6;">${escapeHtml(responsable)}</td></tr>
      </table>`;
  } else if (role === "director") {
    middle = `
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#5a6577;">Cliente</td><td style="padding:8px 0;text-align:right;font-weight:600;">${escapeHtml(razon)}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6577;border-top:1px solid #eef1f6;">Depósito</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6;">${DEPOT_LABEL[order.depot]}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6577;border-top:1px solid #eef1f6;">Responsable</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6;">${escapeHtml(responsable)}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6577;border-top:1px solid #eef1f6;">Horario</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6;">${horario}</td></tr>
      </table>
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8a94a6;margin-top:8px;">Servicios contratados</div>
      <table style="width:100%;border-collapse:collapse;margin:6px 0 0;font-size:14px;">${servicesRows(order)}
        ${totalsRows(order)}
      </table>`;
  } else if (role === "facturacion") {
    middle = `
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#5a6577;">Cliente</td><td style="padding:8px 0;text-align:right;font-weight:600;">${escapeHtml(razon)}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6577;border-top:1px solid #eef1f6;">Fecha</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6;">${fmtDate(order.date)}</td></tr>
      </table>
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8a94a6;margin-top:8px;">Servicios</div>
      <table style="width:100%;border-collapse:collapse;margin:6px 0 0;font-size:14px;">${servicesRows(order)}
        ${totalsRows(order)}
      </table>`;
  } else {
    // cliente
    middle = `
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#5a6577;">Fecha</td><td style="padding:8px 0;text-align:right;font-weight:600;">${fmtDate(order.date)}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6577;border-top:1px solid #eef1f6;">Depósito</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef1f6;">${DEPOT_LABEL[order.depot]}</td></tr>
        ${totalsRows(order)}
      </table>`;
  }

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${pid}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f7f8fb;color:#0b1220;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#050555;color:white;padding:20px 24px;border-radius:10px 10px 0 0;">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;opacity:0.7;">${intro.eyebrow}</div>
      <div style="font-size:24px;font-weight:700;margin-top:4px;">${pid}</div>
      <div style="font-size:13px;opacity:0.85;margin-top:2px;">${DEPOT_LABEL[order.depot]}</div>
    </div>
    <div style="background:white;border:1px solid #dde3ec;border-top:none;padding:24px;border-radius:0 0 10px 10px;">
      ${urgent ? `<div style="margin:0 0 16px;padding:10px 14px;background:#fdecec;border:1px solid #C90812;border-radius:6px;color:#C90812;font-weight:700;font-size:13px;letter-spacing:0.04em;">🚨 ENVÍO URGENTE — ejecución el mismo día · recargo +100%</div>` : ""}
      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">${intro.objetivo}</p>
      ${middle}
      <div style="text-align:center;margin:24px 0;">
        <a href="${publicUrl}" style="display:inline-block;background:#C90812;color:white;padding:12px 28px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;letter-spacing:0.04em;">Ver comprobante online →</a>
      </div>
      ${pdfUrl ? `<p style="margin:16px 0 0;font-size:13px;color:#5a6577;text-align:center;">PDF: <a href="${pdfUrl}" style="color:#214576;">Descargar comprobante</a></p>` : ""}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eef1f6;font-size:12px;color:#8a94a6;line-height:1.5;">
        Logística TOPS — Verotin S.A. · IVA Responsable Inscripto<br>
        Agustín Magaldi 1765 — CABA · Tel/Fax: 4302-3944<br>
        <a href="https://www.logisticatops.com" style="color:#214576;">www.logisticatops.com</a>
      </div>
    </div>
  </div>
</body></html>`;
}
