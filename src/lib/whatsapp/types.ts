/**
 * Tipos del módulo WhatsApp — agnósticos al provider (Meta / Twilio / etc.).
 */

export interface WhatsappSendResult {
  ok: true;
  messageId: string;
  to: string;
  provider: "meta" | "twilio" | "mock";
  template?: string;
}

export interface WhatsappSendError {
  ok: false;
  error: string;
  status?: number;
  provider: "meta" | "twilio" | "mock";
}

export type WhatsappResult = WhatsappSendResult | WhatsappSendError;

/**
 * Componente de template parametrizado de Meta Cloud API.
 * Ej. para una OC: { type: "body", parameters: [{ type: "text", text: "OC-2026-0349" }, ...] }
 */
export interface MetaTemplateComponent {
  type: "header" | "body" | "button" | "footer";
  sub_type?: "url" | "quick_reply";
  index?: string;
  parameters: Array<
    | { type: "text"; text: string }
    | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
    | { type: "date_time"; date_time: { fallback_value: string } }
    | { type: "image"; image: { link: string } }
    | { type: "document"; document: { link: string; filename: string } }
  >;
}

export interface SendTemplateInput {
  /** Destino en formato internacional sin "+" ni espacios (ej "5491131079124"). */
  to: string;
  /** Nombre del template aprobado en Meta. */
  template: string;
  /** Idioma del template (es_AR, en_US, es). */
  language?: string;
  /** Parámetros del template, en orden. */
  components?: MetaTemplateComponent[];
}

export interface SendTextInput {
  to: string;
  /** Texto plano. Solo funciona dentro de la "ventana de 24hs" tras un msg del usuario. */
  text: string;
}

export interface SendDocumentInput {
  to: string;
  /** URL pública del documento (PDF, etc.). */
  documentUrl: string;
  filename: string;
  caption?: string;
}
