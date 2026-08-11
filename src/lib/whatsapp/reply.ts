import "server-only";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { checkOutboundAllowed } from "./sandbox";
import { parseOperatorProfileIds, isOperatorAuthorized } from "./operators";
import { createMetaHttpTransport, type MetaTextTransport } from "./transport";
import { createSupabaseReplyPorts } from "./reply.supabase";
import { executeReply, type ReplyCoreInput, type ReplyCoreResult } from "./reply-core";

/**
 * reply.ts — LINK-WA 1B-1D · Adaptador productivo delgado del outbound.
 *
 * Sólo hace tres cosas: obtener dependencias, construir los ports UNA vez con
 * `createSupabaseReplyPorts` y llamar UNA vez a `executeReply`. No hay cableado
 * inline duplicado: toda la lógica de consulta vive en la factory testeable y
 * toda la decisión en el core puro.
 */

export type { ReplyCoreResult as WhatsappReplyResult } from "./reply-core";
export {
  isValidWhatsappText,
  isValidClientMsgId,
  normalizeWhatsappText,
  counterpartPhoneFromContext,
} from "./reply-core";

export interface WhatsappReplyDeps {
  /** Inyectable para pruebas de integración; en producción no se pasa. */
  transport?: MetaTextTransport;
}

export async function replyToWhatsappThread(
  input: ReplyCoreInput,
  deps: WhatsappReplyDeps = {},
): Promise<ReplyCoreResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, code: "no_session", error: "no_session" };

  const operators = parseOperatorProfileIds();

  const ports = createSupabaseReplyPorts({
    supabase: supabase as never,
    admin: createAdminClient() as never,
    isOperator: (id) => isOperatorAuthorized(id, operators.ids),
    isSandboxAllowed: (phone) => checkOutboundAllowed(phone).allowed,
    clock: { now: () => new Date().toISOString() },
    transport:
      deps.transport ??
      createMetaHttpTransport({
        token: process.env.META_WA_TOKEN,
        phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID,
      }),
  });

  return executeReply(input, ports);
}
