/**
 * Lógica PURA de notificaciones automáticas de Orden de Servicio.
 *
 * Separada de `email.ts` (que hace la llamada real a Resend) para que el plan
 * de destinatarios, el contenido por rol y la deduplicación sean testeables
 * sin DB ni red. Sólo importa tipos y constantes puras (tokens del doc-system
 * y `ORG`), por lo que no arrastra dependencias de runtime (ni env, ni DB).
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
import {
  escapeHtml,
  renderEmailShell,
  textFallback,
} from "./doc-system/email/layout";
import { DOC } from "./doc-system/tokens";

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
    return `<tr><td colspan="2" style="padding:8px 0;color:${DOC.textSec};">Sin servicios detallados.</td></tr>`;
  }
  return svcs
    .map(
      (s) =>
        `<tr><td style="padding:6px 0;border-top:1px solid ${DOC.ruleSoft};">${escapeHtml(s.label)} <span style="color:${DOC.label};">· ${s.qty} ${escapeHtml(String(s.unit))}</span></td><td style="padding:6px 0;text-align:right;font-weight:600;border-top:1px solid ${DOC.ruleSoft};">${fmtMoney(s.subtotal)}</td></tr>`,
    )
    .join("");
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
    `<tr><td style="padding:8px 0;border-top:2px solid ${DOC.navy};color:${DOC.textSec};">Subtotal neto</td>` +
    `<td style="padding:8px 0;text-align:right;border-top:2px solid ${DOC.navy};">${fmtMoney(order.total)}</td></tr>` +
    `<tr><td style="padding:4px 0;color:${DOC.textSec};">IVA (21%)</td>` +
    `<td style="padding:4px 0;text-align:right;">${fmtMoney(iva)}</td></tr>` +
    `<tr><td style="padding:6px 0;font-weight:700;border-top:1px solid ${DOC.ruleSoft};">Total</td>` +
    `<td style="padding:6px 0;text-align:right;font-weight:700;color:${DOC.navy};">${fmtMoney(total)}</td></tr>`
  );
}

/** Fila «label · valor» de las tablas de datos por rol (todo inline). */
function kvRow(label: string, valueHtml: string, first = false): string {
  const bt = first ? "" : `border-top:1px solid ${DOC.ruleSoft};`;
  return `<tr><td style="padding:8px 0;color:${DOC.textSec};${bt}">${label}</td><td style="padding:8px 0;text-align:right;font-weight:600;${bt}">${valueHtml}</td></tr>`;
}

/** Encabezado chico de sección (SERVICIOS…). */
function sectionHeading(label: string): string {
  return `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${DOC.label};margin-top:8px;">${label}</div>`;
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
 * los aporta la plantilla base del doc-system (`renderEmailShell`).
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

  // Bloque central por rol (mismos datos que siempre; sólo cambia la piel).
  let middle = "";
  if (role === "deposito") {
    middle = `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;">
        ${kvRow("Cliente", escapeHtml(razon), true)}
        ${kvRow("Depósito", DEPOT_LABEL[order.depot])}
        ${kvRow("Horario", horario)}
        ${kvRow("Responsable operativo", escapeHtml(responsable))}
      </table>`;
  } else if (role === "director") {
    middle = `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;">
        ${kvRow("Cliente", escapeHtml(razon), true)}
        ${kvRow("Depósito", DEPOT_LABEL[order.depot])}
        ${kvRow("Responsable", escapeHtml(responsable))}
        ${kvRow("Horario", horario)}
      </table>
      ${sectionHeading("Servicios contratados")}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:6px 0 0;font-size:14px;">${servicesRows(order)}
        ${totalsRows(order)}
      </table>`;
  } else if (role === "facturacion") {
    middle = `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;">
        ${kvRow("Cliente", escapeHtml(razon), true)}
        ${kvRow("Fecha", fmtDate(order.date))}
      </table>
      ${sectionHeading("Servicios")}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:6px 0 0;font-size:14px;">${servicesRows(order)}
        ${totalsRows(order)}
      </table>`;
  } else {
    // cliente
    middle = `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;">
        ${kvRow("Fecha", fmtDate(order.date), true)}
        ${kvRow("Depósito", DEPOT_LABEL[order.depot])}
        ${totalsRows(order)}
      </table>`;
  }

  const urgentBanner = urgent
    ? `<div style="margin:0 0 16px;padding:10px 14px;background:#FDECEC;border:1px solid ${DOC.red};border-radius:6px;color:${DOC.red};font-weight:700;font-size:13px;letter-spacing:0.04em;">🚨 ENVÍO URGENTE — ejecución el mismo día · recargo +100%</div>`
    : "";

  return renderEmailShell({
    eyebrow: intro.eyebrow,
    title: pid,
    subtitle: DEPOT_LABEL[order.depot],
    bodyHtml: `${urgentBanner}<p style="margin:0 0 8px;font-size:15px;line-height:1.6;">${intro.objetivo}</p>${middle}`,
    cta: { label: "Ver comprobante online →", url: publicUrl },
    belowCtaHtml: pdfUrl
      ? `<p style="margin:0;font-size:13px;color:${DOC.textSec};text-align:center;">PDF: <a href="${escapeHtml(pdfUrl)}" style="color:${DOC.navy};">Descargar comprobante</a></p>`
      : undefined,
  });
}

/** Servicios en formato texto plano (una línea por servicio). */
function servicesText(order: Order): string[] {
  const svcs = order.services ?? [];
  if (svcs.length === 0) return ["  · Sin servicios detallados."];
  return svcs.map(
    (s) => `  · ${s.label} — ${s.qty} ${String(s.unit)} — ${fmtMoney(s.subtotal)}`,
  );
}

/** Totales discriminados en texto plano (misma fórmula que totalsRows). */
function totalsText(order: Order): string[] {
  const iva = Math.round(order.total * 0.21);
  return [
    `Subtotal neto: ${fmtMoney(order.total)}`,
    `IVA (21%): ${fmtMoney(iva)}`,
    `Total: ${fmtMoney(order.total + iva)}`,
  ];
}

/**
 * Versión text/plain del email por rol (mismos datos que renderRoleHtml).
 * Se pasa como campo `text` del payload de Resend.
 */
export function renderRoleText(
  order: Order,
  role: OrderEmailRole,
  publicUrl: string,
  pdfUrl?: string,
  urgent = false,
): string {
  const intro = ROLE_INTRO[role];
  const razon = order.client?.razon ?? "";
  const horario =
    order.h_start && order.h_end ? `${order.h_start} – ${order.h_end}` : "—";
  const responsable = order.operator?.full_name ?? "—";
  const depot = DEPOT_LABEL[order.depot];

  const middle: string[] = [];
  if (role === "deposito") {
    middle.push(
      `Cliente: ${razon}`,
      `Depósito: ${depot}`,
      `Horario: ${horario}`,
      `Responsable operativo: ${responsable}`,
    );
  } else if (role === "director") {
    middle.push(
      `Cliente: ${razon}`,
      `Depósito: ${depot}`,
      `Responsable: ${responsable}`,
      `Horario: ${horario}`,
      "",
      "Servicios contratados:",
      ...servicesText(order),
      "",
      ...totalsText(order),
    );
  } else if (role === "facturacion") {
    middle.push(
      `Cliente: ${razon}`,
      `Fecha: ${fmtDate(order.date)}`,
      "",
      "Servicios:",
      ...servicesText(order),
      "",
      ...totalsText(order),
    );
  } else {
    middle.push(
      `Fecha: ${fmtDate(order.date)}`,
      `Depósito: ${depot}`,
      "",
      ...totalsText(order),
    );
  }

  return textFallback([
    `${intro.eyebrow.toUpperCase()} — ${order.public_id} · ${depot}`,
    "",
    urgent && "🚨 ENVÍO URGENTE — ejecución el mismo día · recargo +100%",
    urgent && "",
    intro.objetivo,
    "",
    ...middle,
    "",
    `Ver comprobante online: ${publicUrl}`,
    pdfUrl ? `PDF: ${pdfUrl}` : false,
  ]);
}
