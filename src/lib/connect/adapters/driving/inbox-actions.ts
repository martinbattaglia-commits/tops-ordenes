"use server";

// Nexus Link · driving adapter (server action de LECTURA): bandeja archivada (UX-002).
// Fetch diferido desde la pestaña Archivo de ConversationList. Misma frontera que toda
// lectura de Connect: sesión + connect.view; los datos salen de v_connect_inbox
// (security_invoker + membresía por auth.uid()) vía listInbox({archived: true}).

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { canAccess } from "@/lib/rbac/guard";
import { canReadInternalChat } from "@/lib/rbac/internal-chat";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { InboxItem } from "../../types";
import { listInbox } from "../../read/inbox-data";
import { archiveFailureMessage, type ArchiveBlockReason } from "../../archive-policy";

export type ArchivedInboxResult =
  | { ok: true; items: InboxItem[] }
  | { ok: false; message: string };

/** INC-01: el resultado de archivar dice, además del mensaje, QUÉ causa lo bloqueó. */
export type ArchiveInboxResult =
  | { ok: true }
  | { ok: false; message: string; reason?: ArchiveBlockReason };

/**
 * UX-002c: archivar directo desde la fila de la bandeja. Intenta primero la vía de
 * ENTIDAD (0206: tarea/incidente terminado — el asignado-member puede) y cae a la
 * manual (connect_archive_conversation: owner/moderator/admin). Las RPCs re-validan
 * todo; acá sólo se elige el camino y se traduce el error si ninguna aplica.
 *
 * INC-01/D-1: antes se descartaban `first.error` y `fallback.error` y se devolvía una
 * cadena fija que nombraba las DOS causas a la vez — el código no sabía cuál había
 * fallado. Ahora los errores reales se leen y se clasifican en `archive-policy`, que
 * devuelve UNA causa con su redacción humana. El texto del motor no llega a pantalla.
 */
export async function archiveInboxItemAction(raw: unknown): Promise<ArchiveInboxResult> {
  const p = z.object({ conversationId: z.string().min(1) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: la acción no se persiste." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess("connect.view"))) {
    return { ok: false, message: "Sin permiso (connect.view)." };
  }
  const args = { p_conversation_id: p.data.conversationId };
  const first = await supabase.rpc("connect_archive_entity_thread", args);
  if (first.error) {
    const fallback = await supabase.rpc("connect_archive_conversation", args);
    if (fallback.error) {
      // Las dos puertas quedaron cerradas: se informa la causa real, una sola.
      const { reason, message } = archiveFailureMessage(first.error, fallback.error);
      return { ok: false, message, reason };
    }
  }
  revalidatePath("/connect", "layout");
  return { ok: true };
}

export async function listArchivedInboxAction(): Promise<ArchivedInboxResult> {
  const demo = env.app.demoMode || env.app.needsSupabase;
  const supabase = createClient();
  if (!demo && supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, message: "Sesión no autenticada." };
    if (!(await canReadInternalChat())) {
      return { ok: false, message: "Sin permiso (connect.view)." };
    }
  }
  return { ok: true, items: await listInbox({ archived: true }) };
}
