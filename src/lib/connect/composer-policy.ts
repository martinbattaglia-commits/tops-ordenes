/**
 * composer-policy.ts — LINK-WA WA-8 · Qué puede hacer el composer, por tipo de
 * conversación.
 *
 * Puro y sin I/O: no importa acciones, ni Supabase, ni React. Existe para que la
 * restricción de WhatsApp viva en la LÓGICA y no en el CSS — ocultar un botón no
 * impide que un atajo de teclado, un dictado o un re-render disparen la acción
 * igual. `ThreadView` consulta estas capacidades y además las vuelve a exigir
 * antes de ejecutar cada camino.
 */

import type { ConversationKind } from "./types";

/**
 * Universo cerrado de kinds. Cualquier otra cosa es fail-closed.
 *
 * ⚠ ESTA LISTA ES UNA COPIA DEL ENUM `connect_conversation_kind_t`. Cuando una
 * migración agrega un valor allá y nadie lo agrega acá, el composer enmudece
 * para ese kind sin que nada lo delate: fue exactamente lo que pasó con `task`
 * durante ocho días. `composer-policy.enum.test.ts` compara esta lista contra
 * las migraciones en disco para que no vuelva a pasar en silencio.
 */
export const CONVERSATION_KINDS = [
  "dm",
  "group",
  "channel",
  "erp",
  "incident",
  "whatsapp",
  "ai",
  // INC-04-R2 · vive en el enum desde 0167 y faltaba acá. Un hilo de tarea es
  // chat interno del tenant igual que uno de incidente, así que sus capacidades
  // son las mismas: texto, audio, adjuntos y menciones.
  "task",
] as const;

/** Falla la compilación si `types.ts` agrega un kind y este archivo no se entera. */
type KindsAreExhaustive = ConversationKind extends (typeof CONVERSATION_KINDS)[number]
  ? true
  : never;
const _kindsAreExhaustive: KindsAreExhaustive = true;
void _kindsAreExhaustive;

export function isConversationKind(value: unknown): value is ConversationKind {
  return (
    typeof value === "string" && (CONVERSATION_KINDS as readonly string[]).includes(value)
  );
}

/** ¿Esta conversación despacha por el outbound WhatsApp? SÓLO por `kind`. */
export function isWhatsappKind(kind: unknown): boolean {
  return kind === "whatsapp";
}

/**
 * Clases de la burbuja PROPIA según el canal.
 *
 * Vive acá y no en `ThreadView` por la misma razón que el resto de las
 * decisiones por `kind`: el componente no compara el canal, lo consulta. Así
 * la regla queda en un módulo puro, testeable, y el contrato estructural que
 * prohíbe condicionales sobre `kind` en la vista se mantiene.
 *
 * WhatsApp usa su verde distintivo; el resto de Connect conserva el rosa de
 * marca. Ambos son tokens semánticos: el modo oscuro los voltea solo.
 */
export function ownBubbleClass(kind: unknown): string {
  return isWhatsappKind(kind)
    ? "border border-wa-stroke bg-wa-bubble text-fg-primary"
    : "bg-tops-red/10 text-fg-primary";
}

/**
 * Clase de color del botón de envío según el canal.
 *
 * Misma vía que `ownBubbleClass`: la vista consulta, no compara. `.btn-wa` y
 * `.btn-nexus` comparten forma, tamaño y anillo de foco; sólo cambia la
 * identidad de color, para que el operador vea de inmediato por qué canal está
 * a punto de escribir.
 */
export function sendButtonClass(kind: unknown): string {
  return isWhatsappKind(kind) ? "btn-wa" : "btn-nexus";
}

export interface ComposerCapabilities {
  /** Enviar texto por el camino que corresponda (Connect o WhatsApp). */
  canSendText: boolean;
  /** Grabar y enviar mensajes de voz. */
  canSendAudio: boolean;
  /** Adjuntar imágenes, fotos y archivos. */
  canAttachFile: boolean;
  /** Menciones internas `@` (sólo Connect: la FK exige miembros del tenant). */
  canMention: boolean;
}

const NONE: ComposerCapabilities = {
  canSendText: false,
  canSendAudio: false,
  canAttachFile: false,
  canMention: false,
};

/**
 * Capacidades efectivas del composer.
 *
 * WhatsApp era TEXT-ONLY en WA-8. No era una regla de negocio: era la
 * consecuencia de que no existiera camino de salida para media —mandar un
 * adjunto habría requerido inventarlo—. FASE B construye ese camino con los
 * endpoints oficiales de Meta (`/media` para subir, `/messages` para enviar),
 * así que audio y adjuntos quedan habilitados también en WhatsApp.
 *
 * Las MENCIONES siguen prohibidas ahí, y por un motivo que no cambió: una
 * mención interna no significa nada del lado del contacto y filtraría nombres
 * del tenant a un tercero.
 *
 * Un `kind` desconocido o ausente NO habilita nada: si el composer no sabe a
 * dónde va el mensaje, no puede elegir un camino, y adivinar es exactamente lo
 * que el contrato prohíbe.
 */
export function composerCapabilities(
  kind: unknown,
  options: { readOnly?: boolean } = {},
): ComposerCapabilities {
  if (options.readOnly === true) return NONE;
  if (!isConversationKind(kind)) return NONE;
  if (isWhatsappKind(kind)) {
    return { canSendText: true, canSendAudio: true, canAttachFile: true, canMention: false };
  }
  return { canSendText: true, canSendAudio: true, canAttachFile: true, canMention: true };
}

/**
 * INC-04-R2 · POR QUÉ EL COMPOSER NO DEJA ESCRIBIR, EN PALABRAS.
 *
 * `composerCapabilities` dice QUÉ se puede hacer; esto dice POR QUÉ no se puede,
 * que es lo que le faltaba al usuario. Cuando `task` quedó fuera del universo
 * cerrado, el composer devolvía NONE y la vista no mostraba nada: el botón
 * quedaba `disabled` y `send()` retornaba sin señal. Escribir y que no pase nada
 * es indistinguible de un sistema roto, y por eso el defecto duró ocho días.
 *
 * Vive acá y no en la vista por el mismo contrato que el resto de las
 * decisiones por `kind`: `ThreadView` CONSULTA, no compara.
 *
 * `null` significa «se puede escribir». Cualquier otro valor es un cartel que
 * la vista debe mostrar EN LUGAR del composer: ofrecer un campo de texto que no
 * va a enviar nada es la promesa que este expediente vino a romper.
 */
export type ComposerBlockReason = "read_only" | "unknown_kind";

export interface ComposerBlockNotice {
  reason: ComposerBlockReason;
  message: string;
}

/** Mensaje estable cuando el composer no sabe a dónde iría el mensaje. */
export const UNKNOWN_KIND_MESSAGE =
  "No se pudo determinar el tipo de conversación. No se envió nada.";

const READ_ONLY_MESSAGE =
  "Esta conversación está archivada. Es de solo lectura: no se pueden enviar mensajes.";

export function composerBlockNotice(
  kind: unknown,
  options: { readOnly?: boolean } = {},
): ComposerBlockNotice | null {
  if (options.readOnly === true) {
    return { reason: "read_only", message: READ_ONLY_MESSAGE };
  }
  if (!isConversationKind(kind)) {
    // El texto es el MISMO que devuelve `dispatchComposerSend` para este caso:
    // el usuario no debería leer dos explicaciones distintas del mismo hecho
    // según por dónde se entere.
    return { reason: "unknown_kind", message: UNKNOWN_KIND_MESSAGE };
  }
  return null;
}

/**
 * Estado visual de la burbuja optimista.
 *
 * `pending` es deliberadamente distinto de `failed`: un envío ambiguo pudo haber
 * llegado. Pintarlo como fallo invita al operador a reintentar y a duplicar un
 * mensaje que el contacto ya recibió.
 */
export type ComposerBubbleStatus = "sending" | "pending" | "failed" | undefined;

export function bubbleStatusFor(outcome: {
  status: "sent" | "pending" | "failed";
}): ComposerBubbleStatus {
  if (outcome.status === "sent") return undefined;
  if (outcome.status === "pending") return "pending";
  return "failed";
}

/**
 * Opciones del grabador de voz según el canal.
 *
 * Vive acá por la misma razón que `ownBubbleClass` y `sendButtonClass`: la
 * vista CONSULTA la decisión por `kind`, no la compara. El contrato estructural
 * prohíbe condicionales sobre `kind` dentro de `ThreadView`, y esto lo respeta.
 *
 * Lo que decide no es cosmético: WhatsApp no reproduce WebM, así que en ese
 * canal la negociación se restringe a formatos que Meta acepte. Ver
 * `MIME_PREFERIDOS_WHATSAPP` en `audio/recorder.ts`.
 */
export function audioRecorderOptionsFor(kind: unknown): { forWhatsapp: boolean } {
  return { forWhatsapp: isWhatsappKind(kind) };
}
