/**
 * composer-dispatch.ts — LINK-WA WA-8 · Despacho del composer por `conversation.kind`.
 *
 * Puro y con dependencias INYECTADAS: no importa server actions, ni Supabase, ni
 * React. Recibe las dos acciones y elige UNA. Por eso se puede probar que jamás
 * se ejecutan las dos, que un kind desconocido no ejecuta ninguna, y que a
 * WhatsApp no viajan menciones.
 *
 * El único criterio de ruteo es `kind`. Nunca el título, el teléfono, la URL ni
 * el contenido: una heurística sobre el cuerpo mandaría a un tercero un mensaje
 * pensado para el equipo, y al revés.
 */

import { isConversationKind, isWhatsappKind } from "./composer-policy";
import { PENDING_MESSAGE } from "@/lib/whatsapp/reply-action-core";

/** Resultado de la Server Action de Connect (`postMessageAction`). */
export type ConnectPostResult =
  | { ok: true; messageId: string; seq: number }
  | { ok: false; message: string };

/** Resultado de la Server Action de WhatsApp (`sendWhatsappTextAction`). */
export type WhatsappSendResult =
  | { ok: true; messageId: string }
  | { ok: false; state: "rejected" | "pending"; message: string };

export interface ComposerDispatchPorts {
  postConnectMessage(input: {
    conversationId: string;
    body: string;
    clientMsgId: string;
    mentions: string[];
  }): Promise<ConnectPostResult>;

  sendWhatsappText(input: {
    conversationId: string;
    text: string;
    clientMsgId: string;
  }): Promise<WhatsappSendResult>;
}

export interface ComposerDispatchInput {
  kind: unknown;
  conversationId: string;
  body: string;
  clientMsgId: string;
  /** Menciones ya resueltas por el dominio. Se DESCARTAN en el camino WhatsApp. */
  mentions?: string[];
}

export type ComposerRoute = "connect" | "whatsapp" | "none";

export type ComposerOutcome =
  | { route: "connect"; status: "sent"; messageId: string; seq: number }
  | { route: "whatsapp"; status: "sent"; messageId: string }
  | { route: ComposerRoute; status: "pending"; message: string }
  | { route: ComposerRoute; status: "failed"; message: string };

/** Mensaje estable cuando el composer no sabe a dónde iría el mensaje. */
export const UNKNOWN_KIND_MESSAGE =
  "No se pudo determinar el tipo de conversación. No se envió nada.";

/**
 * WA-8R1 · mensaje estable cuando la acción de Connect no responde.
 *
 * En Connect sí puede presentarse como fallo: si la Server Action no responde,
 * el RPC `connect_post_message` no confirmó nada y no hay un tercero al que se
 * le haya podido entregar el mensaje. El operador puede volver a escribir sin
 * riesgo de duplicar del lado del contacto.
 */
export const CONNECT_UNAVAILABLE_MESSAGE =
  "No se pudo enviar el mensaje. Probá de nuevo.";

/**
 * Despacha UNA sola acción según `kind`.
 *
 *  · `whatsapp` → exactamente una llamada WhatsApp, sin menciones ni adjuntos;
 *  · cualquier otro kind válido → exactamente una llamada Connect, con la
 *    semántica actual intacta (menciones incluidas);
 *  · kind ausente o desconocido → CERO acciones.
 */
export async function dispatchComposerSend(
  input: ComposerDispatchInput,
  ports: ComposerDispatchPorts,
): Promise<ComposerOutcome> {
  const { kind, conversationId, body, clientMsgId } = input;

  if (!isConversationKind(kind)) {
    return { route: "none", status: "failed", message: UNKNOWN_KIND_MESSAGE };
  }

  if (isWhatsappKind(kind)) {
    // `mentions` NO se reenvía: el outbound es text-only y una mención interna
    // no tiene destinatario del otro lado.
    let res: WhatsappSendResult;
    try {
      res = await ports.sendWhatsappText({ conversationId, text: body, clientMsgId });
    } catch {
      // WA-8R1 · la Server Action no respondió (red caída, request abortado,
      // error de transporte del propio framework). No se sabe si el servidor
      // llegó a procesar el intento, así que la respuesta es AMBIGUA, no un
      // fallo: `pending`, sin reintento y sin leer el error.
      return { route: "whatsapp", status: "pending", message: PENDING_MESSAGE };
    }
    if (res.ok) return { route: "whatsapp", status: "sent", messageId: res.messageId };
    return {
      route: "whatsapp",
      status: res.state === "pending" ? "pending" : "failed",
      message: res.message,
    };
  }

  let res: ConnectPostResult;
  try {
    res = await ports.postConnectMessage({
      conversationId,
      body,
      clientMsgId,
      mentions: input.mentions ?? [],
    });
  } catch {
    // Connect sí admite fallo seguro: sin respuesta no hubo confirmación del
    // RPC y no hay un tercero que haya podido recibir el mensaje.
    return { route: "connect", status: "failed", message: CONNECT_UNAVAILABLE_MESSAGE };
  }
  if (res.ok) {
    return { route: "connect", status: "sent", messageId: res.messageId, seq: res.seq };
  }
  return { route: "connect", status: "failed", message: res.message };
}
