import { env } from "@/lib/env";
import { checkOutboundAllowed } from "./sandbox";
import type {
  WhatsappResult,
  SendTemplateInput,
  SendTextInput,
  SendDocumentInput,
  MetaTemplateComponent,
} from "./types";

/**
 * Cliente WhatsApp Business Cloud API (Meta) v22.0.
 *
 * Auth: `Authorization: Bearer <META_WA_TOKEN>`
 * Endpoint: https://graph.facebook.com/v22.0/{phone_number_id}/messages
 *
 * Reglas de Meta:
 *  - Mensajes "template" (HSM): se pueden enviar SIEMPRE (incluso a usuarios
 *    que no escribieron primero). Solo si el template está APPROVED.
 *  - Mensajes "text" / "document" / "image" libres: solo dentro de la
 *    ventana de 24hs tras el último mensaje del usuario.
 *
 * Para flujos B2B (notificar proveedor que su OC fue firmada) usamos templates.
 */

const GRAPH = "https://graph.facebook.com/v22.0";

interface MetaApiError {
  error?: {
    message: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface MetaSendResponse {
  messaging_product: "whatsapp";
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status?: string }>;
}

function normalizePhone(raw: string): string {
  // E.164 sin "+" — Meta requiere solo dígitos
  return raw.replace(/[^\d]/g, "");
}

function isConfigured(): boolean {
  return Boolean(env.whatsapp.metaToken && env.whatsapp.phoneNumberId);
}

async function callMeta(path: string, body: unknown): Promise<WhatsappResult> {
  if (!isConfigured()) {
    return {
      ok: false,
      error: "WhatsApp Meta no configurado (META_WA_TOKEN + META_WA_PHONE_NUMBER_ID)",
      status: 503,
      provider: "meta",
    };
  }

  // F4.4-E3 (fix adversarial): el sandbox se aplica en el CHOKE POINT — todo
  // egress real pasa por acá (incluido el sendText directo de compras/OC, que
  // no pasa por /api/whatsapp/send). Con WHATSAPP_SANDBOX != "0", destino
  // fuera de WHATSAPP_SANDBOX_ALLOWLIST ⇒ no sale nada (D-F44-3).
  const to = (body as { to?: unknown } | null)?.to;
  if (typeof to === "string" || typeof to === "number") {
    const decision = checkOutboundAllowed(String(to));
    if (!decision.allowed) {
      return {
        ok: false,
        error:
          "Sandbox WhatsApp activo: destino fuera de WHATSAPP_SANDBOX_ALLOWLIST (D-F44-3; sin envíos productivos en F4.4)",
        status: 403,
        provider: "meta",
      };
    }
  }

  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.whatsapp.metaToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as MetaApiError;
    return {
      ok: false,
      error:
        errBody.error?.message ??
        `Meta API ${res.status} ${res.statusText}`,
      status: res.status,
      provider: "meta",
    };
  }

  const data = (await res.json()) as MetaSendResponse;
  return {
    ok: true,
    messageId: data.messages?.[0]?.id ?? "(sin id)",
    to: data.contacts?.[0]?.wa_id ?? "(sin destino)",
    provider: "meta",
  };
}

// ------------------------------------------------------------------
// PUBLIC API
// ------------------------------------------------------------------

export async function sendTemplate(input: SendTemplateInput): Promise<WhatsappResult> {
  const to = normalizePhone(input.to);
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: input.template,
      language: { code: input.language ?? "es" },
    },
  };
  if (input.components?.length) {
    (body.template as Record<string, unknown>).components = input.components;
  }
  const result = await callMeta(`${env.whatsapp.phoneNumberId}/messages`, body);
  if (result.ok) result.template = input.template;
  return result;
}

export async function sendText(input: SendTextInput): Promise<WhatsappResult> {
  return callMeta(`${env.whatsapp.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: normalizePhone(input.to),
    type: "text",
    text: { body: input.text.slice(0, 4096), preview_url: true },
  });
}

export async function sendDocument(input: SendDocumentInput): Promise<WhatsappResult> {
  return callMeta(`${env.whatsapp.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: normalizePhone(input.to),
    type: "document",
    document: {
      link: input.documentUrl,
      filename: input.filename,
      caption: input.caption,
    },
  });
}

/**
 * Helpers de templates corporativos pre-armados.
 * Asumen que estos templates existen y están APPROVED en el WABA.
 * Si no, podés usar `sendText` dentro de la ventana 24hs.
 */
export const templates = {
  /**
   * Notifica al proveedor que recibió una OC firmada.
   * Template suggested: `oc_firmada` (2 vars: número OC, monto)
   * Variables: {{1}}=OC-2026-NNNN, {{2}}=monto formateado.
   */
  async ocFirmada(opts: { to: string; publicId: string; total: string; pdfUrl?: string }) {
    const components: MetaTemplateComponent[] = [
      {
        type: "body",
        parameters: [
          { type: "text", text: opts.publicId },
          { type: "text", text: opts.total },
        ],
      },
    ];
    if (opts.pdfUrl) {
      components.push({
        type: "header",
        parameters: [
          {
            type: "document",
            document: { link: opts.pdfUrl, filename: `${opts.publicId}.pdf` },
          },
        ],
      });
    }
    return sendTemplate({
      to: opts.to,
      template: "oc_firmada",
      language: "es",
      components,
    });
  },

  /** Template universal de fallback: hello_world (siempre disponible). */
  async helloWorld(to: string) {
    return sendTemplate({ to, template: "hello_world", language: "en_US" });
  },
};

// ------------------------------------------------------------------
// Diagnostics
// ------------------------------------------------------------------

export interface WhatsappPing {
  ok: true;
  phoneNumberId: string;
  displayPhone: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  tokenExpiresAt: string | null;
}

export async function ping(): Promise<WhatsappPing | { ok: false; error: string }> {
  if (!isConfigured()) {
    return { ok: false, error: "WhatsApp Meta no configurado" };
  }
  const res = await fetch(
    `${GRAPH}/${env.whatsapp.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    {
      headers: { Authorization: `Bearer ${env.whatsapp.metaToken}` },
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: `Meta ${res.status}: ${JSON.stringify(err).slice(0, 200)}` };
  }
  const data = await res.json();
  return {
    ok: true,
    phoneNumberId: env.whatsapp.phoneNumberId!,
    displayPhone: data.display_phone_number ?? null,
    verifiedName: data.verified_name ?? null,
    qualityRating: data.quality_rating ?? null,
    tokenExpiresAt: null,
  };
}

export { isConfigured as isWhatsappConfigured };
