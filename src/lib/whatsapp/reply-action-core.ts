/**
 * reply-action-core.ts — LINK-WA WA-8 · Núcleo de la Server Action del composer.
 *
 * Vive separado del archivo `"use server"` por dos razones concretas:
 *  1. un módulo con `"use server"` sólo puede exportar funciones async, así que
 *     no podría exportar tipos, constantes ni una función con puertos inyectados;
 *  2. con el puerto inyectado se puede probar con un fake que `replyToWhatsappThread`
 *     se llama EXACTAMENTE una vez y que ninguna respuesta filtra datos internos.
 *
 * No duplica autorización, sandbox, claim, auditoría, sello ni transporte: todo
 * eso ya vive en el core aprobado por WA-7C4 y esta capa no lo vuelve a decidir.
 * Acá sólo hay validación de entrada y traducción de resultado a UI.
 */

import { isValidClientMsgId, isValidWhatsappText, normalizeWhatsappText } from "./reply-core";
import type { ReplyCoreResult, ReplyErrorCode } from "./reply-core";

/** UUID canónico, misma gramática que el resto del expediente. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Claves EXACTAS admitidas en la entrada. Ninguna adicional. */
const INPUT_KEYS = ["conversationId", "text", "clientMsgId"] as const;

/**
 * Texto único para todo resultado ambiguo o en vuelo.
 *
 * Es literal y sin variantes a propósito: cualquier matiz ("puede que haya
 * salido", "reintentá en un rato") invita a mandarlo de nuevo, y un segundo
 * egress sobre un mensaje que Meta ya aceptó le duplica el mensaje al contacto.
 */
export const PENDING_MESSAGE = "Envío pendiente de confirmación. No lo reintentes.";

export type WhatsappComposerResult =
  /** `messageId` es la fila propia, no el wamid: es lo que realtime reconcilia. */
  | { ok: true; messageId: string }
  | { ok: false; state: "pending"; message: string }
  | { ok: false; state: "rejected"; message: string };

/**
 * Códigos que significan "no sabemos si llegó". NUNCA se presentan como fallo
 * definitivo y NUNCA habilitan un reintento automático.
 */
const PENDING_CODES: ReadonlyArray<ReplyErrorCode> = ["reconciliation_required", "in_flight"];

/**
 * Mensajes ESTABLES por código. No se deriva ninguno del proveedor: `detail`,
 * `error.message` de Meta, wamid, teléfono, texto y stack quedan del lado del
 * servidor. Un código sin entrada cae al genérico, nunca al valor crudo.
 */
const REJECTED_MESSAGES: Record<ReplyErrorCode, string> = {
  invalid_input: "El mensaje no es válido.",
  no_session: "Sesión no autenticada.",
  not_operator: "No tenés permiso para responder por WhatsApp.",
  not_tenant_member: "No tenés permiso para responder por WhatsApp.",
  no_thread: "La conversación no existe o no tenés acceso.",
  no_counterpart: "La conversación no tiene un número de WhatsApp asociado.",
  rbac_denied: "Sin permiso para enviar mensajes en esta conversación.",
  attempt_binding_mismatch: "No se pudo verificar el intento. Volvé a escribir el mensaje.",
  attempt_not_verifiable: "No se pudo verificar el intento. Volvé a escribir el mensaje.",
  attempt_closed: "Este intento ya está cerrado. Escribí un mensaje nuevo.",
  audit_failed: "No se pudo registrar el envío. No se envió nada.",
  sandbox_denied: "El destinatario no está habilitado para enviar en este entorno.",
  state_unavailable: "No se pudo leer el estado del envío. Probá de nuevo más tarde.",
  send_failed: "WhatsApp rechazó el mensaje.",
  // Presentes por exhaustividad del tipo; se resuelven antes como `pending`.
  reconciliation_required: PENDING_MESSAGE,
  in_flight: PENDING_MESSAGE,
};

const GENERIC_REJECTED = "No se pudo enviar el mensaje.";

export const INVALID_INPUT_RESULT: WhatsappComposerResult = {
  ok: false,
  state: "rejected",
  message: REJECTED_MESSAGES.invalid_input,
};

export interface WhatsappActionPorts {
  reply(input: {
    conversationId: string;
    text: string;
    clientMsgId: string;
  }): Promise<ReplyCoreResult>;
}

/** Entrada válida y normalizada, o `null`. Fail-closed, sin recortes. */
export function parseWhatsappComposerInput(
  raw: unknown,
): { conversationId: string; text: string; clientMsgId: string } | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== INPUT_KEYS.length) return null;
  for (const key of keys) {
    if (!(INPUT_KEYS as readonly string[]).includes(key)) return null;
  }

  const { conversationId, text, clientMsgId } = obj;
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return null;
  if (typeof text !== "string" || !isValidWhatsappText(text)) return null;
  if (typeof clientMsgId !== "string" || !isValidClientMsgId(clientMsgId)) return null;

  return {
    conversationId,
    text: normalizeWhatsappText(text),
    clientMsgId: clientMsgId.trim().toLowerCase(),
  };
}

/** Traduce el resultado del core a algo que la UI pueda mostrar sin filtrar nada. */
export function toComposerResult(result: ReplyCoreResult): WhatsappComposerResult {
  if (result.ok) return { ok: true, messageId: result.messageId };
  if (PENDING_CODES.includes(result.code)) {
    return { ok: false, state: "pending", message: PENDING_MESSAGE };
  }
  return {
    ok: false,
    state: "rejected",
    message: REJECTED_MESSAGES[result.code] ?? GENERIC_REJECTED,
  };
}

/** Resultado ambiguo canónico. Se usa también ante una excepción del puerto. */
export const PENDING_RESULT: WhatsappComposerResult = {
  ok: false,
  state: "pending",
  message: PENDING_MESSAGE,
};

/**
 * Ejecuta el intento. Una sola llamada al core; entrada inválida ⇒ CERO llamadas.
 *
 * ── WA-8R1 · EXCEPCIÓN ⇒ PENDING, NUNCA FAILED ────────────────────────────
 *
 * Si el core arroja —un error de red hacia Supabase, un timeout de
 * infraestructura, un bug inesperado— NO se sabe hasta dónde llegó el intento:
 * pudo no haber salido, o pudo haberse sellado el wamid y haberse perdido la
 * respuesta. Presentarlo como `failed` afirmaría lo primero sin evidencia, y el
 * operador reintentaría un mensaje que el contacto quizá ya recibió.
 *
 * Por eso una excepción se traduce al MISMO resultado ambiguo que
 * `reconciliation_required`: `pending`, con el texto que desaconseja reintentar.
 * El error se descarta sin inspeccionarlo: ni `message`, ni `stack`, ni ninguna
 * propiedad suya puede filtrarse a la UI.
 */
export async function executeWhatsappComposerSend(
  raw: unknown,
  ports: WhatsappActionPorts,
): Promise<WhatsappComposerResult> {
  const input = parseWhatsappComposerInput(raw);
  if (!input) return INVALID_INPUT_RESULT;

  let result: ReplyCoreResult;
  try {
    result = await ports.reply(input);
  } catch {
    // Sin segundo intento y sin leer el error: la ambigüedad es el resultado.
    return PENDING_RESULT;
  }
  return toComposerResult(result);
}
