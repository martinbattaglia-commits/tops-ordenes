"use server";

/**
 * reply-action.ts — LINK-WA WA-8 · Server Action del composer para WhatsApp.
 *
 * Deliberadamente de una sola línea útil: toda la validación y la traducción
 * viven en `reply-action-core` (puro y probado), y toda la decisión de negocio
 * en el core aprobado por WA-7C4. Acá sólo se inyecta el adaptador productivo.
 *
 * NO es un endpoint público: es una Server Action, sólo invocable desde el
 * composer del propio hilo. El navegador nunca toca Meta, Supabase admin ni
 * `service_role`; todo eso queda del lado del servidor, detrás de esta frontera.
 */

import { replyToWhatsappThread } from "./reply";
import {
  executeWhatsappComposerSend,
  type WhatsappComposerResult,
} from "./reply-action-core";

export async function sendWhatsappTextAction(raw: unknown): Promise<WhatsappComposerResult> {
  return executeWhatsappComposerSend(raw, { reply: replyToWhatsappThread });
}
