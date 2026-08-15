import "server-only";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { checkOutboundAllowed } from "./sandbox";
import { parseOperatorProfileIds, isOperatorAuthorized } from "./operators";
import { createMetaMediaTransport, type MetaMediaTransport } from "./media-transport";
import { createSupabaseReplyPorts } from "./reply.supabase";
import { sendWhatsappMedia, type MediaSendInput, type MediaSendResult } from "./media-send-core";

/**
 * media-send.ts — NEXUS LINK FASE B · adaptador productivo del envío de media.
 *
 * Mismo principio que `reply.ts` (LINK-WA 1B-1D): delgado a propósito. No
 * reimplementa el CAS ni la máquina de estados — los toma PRESTADOS de
 * `createSupabaseReplyPorts`, la misma factory que ya usa el texto, porque
 * `MediaSendPorts.state` es el mismo subconjunto de `ReplyPorts.state`
 * (claimSending/sealSent/stamp), keyeado por el mismo `messageId` sobre la
 * misma tabla `connect_messages`. Un segundo CAS para el mismo problema sería
 * exactamente el transporte paralelo que Dirección prohibió.
 *
 * `.transport` de `ReplyPorts` (texto) no se usa acá — sólo se toma `.state`
 * del objeto devuelto — así que se le pasa un transporte que nunca se invoca;
 * `state.claimSending/sealSent/stamp` cierran sólo sobre `admin` y `clock`
 * (ver `reply.supabase.ts`), nunca sobre `transport`.
 *
 * ─── HALLAZGO DE C4 (2026-08-14), CORREGIDO ACÁ ────────────────────────────
 *
 * El texto tiene DOS fronteras independientes antes de tocar Meta:
 * `nexus_link.whatsapp.send` (RBAC, en `reply-action.ts`) Y la allowlist de
 * operadores `WHATSAPP_SANDBOX_OPERATOR_PROFILE_IDS` (deny-by-default,
 * verificada DENTRO de `reply-core.ts` vía `ports.operators.isAuthorized`).
 * El envío de media construía `isOperator` —está arriba, en `deps` de
 * `createSupabaseReplyPorts`— pero nunca lo CONSULTABA: se tomaba `.state` del
 * objeto devuelto y se descartaba `.operators` sin usar. Como
 * `media-send-core.ts` no tiene noción de operadores (fue diseñado sólo con
 * `state`/`objects`/`transport`/`sandbox`), la frontera se chequea ACÁ, en la
 * costura — mismo lugar donde el texto la agrega además de la del core.
 */

export type { MediaSendResult } from "./media-send-core";

export interface WhatsappMediaSendDeps {
  /** Inyectable para pruebas de integración; en producción no se pasa. */
  transport?: MetaMediaTransport;
}

export interface SendMediaForAttachmentInput {
  messageId: string;
  to: string;
  bucket: string;
  path: string;
  mimeType: string;
  fileName: string;
  caption?: string;
}

export async function sendWhatsappMediaForAttachment(
  input: SendMediaForAttachmentInput,
  deps: WhatsappMediaSendDeps = {},
): Promise<MediaSendResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, state: "failed", message: "Sin sesión." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, state: "failed", message: "Sin cliente de servicio." };

  const operators = parseOperatorProfileIds();

  // Transporte NUNCA invocado por estos ports (ver docblock): un stub que
  // fallara si se llamara sería más seguro que uno que fingiera éxito.
  const transporteInerte = {
    async sendText() {
      throw new Error("media-send: transporte de texto invocado por error");
    },
  };

  const full = createSupabaseReplyPorts({
    supabase: supabase as never,
    admin: admin as never,
    isOperator: (id) => isOperatorAuthorized(id, operators.ids),
    isSandboxAllowed: (phone) => checkOutboundAllowed(phone).allowed,
    clock: { now: () => new Date().toISOString() },
    transport: transporteInerte as never,
  });

  // Misma frontera y mismo orden que `executeReply` (reply-core.ts): actor
  // primero, allowlist de operadores después. `full.session`/`full.operators`
  // son el mismo objeto que el texto ya usa — cero lógica de autorización nueva.
  const actor = await full.session.getActor();
  if (!actor) return { ok: false, state: "failed", message: "Sin sesión." };
  if (!full.operators.isAuthorized(actor.id)) {
    await full.audit.record("reply_denied", { reason: "not_operator", actor: actor.id });
    return { ok: false, state: "failed", message: "No autorizado (operador)." };
  }

  const mediaInput: MediaSendInput = {
    messageId: input.messageId,
    to: input.to,
    bucket: input.bucket,
    path: input.path,
    mimeType: input.mimeType,
    fileName: input.fileName,
    caption: input.caption,
  };

  return sendWhatsappMedia(mediaInput, {
    state: full.state,
    objects: {
      async read(bucket, path) {
        const { data, error } = await admin.storage.from(bucket).download(path);
        if (error || !data) return null;
        return new Uint8Array(await data.arrayBuffer());
      },
    },
    transport:
      deps.transport ??
      createMetaMediaTransport({
        token: process.env.META_WA_TOKEN,
        phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID,
      }),
    sandbox: { isAllowed: (phone) => checkOutboundAllowed(phone).allowed },
  });
}
