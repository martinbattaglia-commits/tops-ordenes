"use server";

// Nexus Link · driving adapter RC1.3: get-or-create de la conversación contextual de una entidad.
// Fail-closed (sesión + connect.create + zod). Escritura por sesión vía RPC SECDEF 0152.

import { z } from "zod";
import { canAccess } from "@/lib/rbac/guard";
import { createClient } from "@/lib/supabase/server";
import { CONNECT_ENTITY_TYPES } from "../../types";

const Schema = z.object({
  entityType: z.enum(CONNECT_ENTITY_TYPES),
  entityId: z.string().min(1).nullable().optional(),
  entityIdText: z.string().min(1).nullable().optional(),
});

export type EntityConversationResult =
  | { ok: true; conversationId: string; contextId: string }
  | { ok: false; message: string };

export async function getOrCreateEntityConversationAction(raw: unknown): Promise<EntityConversationResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: la conversación contextual no se persiste (sin Supabase)." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess("connect.create"))) {
    return { ok: false, message: "Sin permiso para abrir conversaciones (connect.create)." };
  }
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };

  const isText = parsed.data.entityType === "compliance_items";
  const { data, error } = await supabase.rpc("connect_get_or_create_entity_conversation", {
    p_entity_type: parsed.data.entityType,
    p_entity_id: isText ? null : parsed.data.entityId ?? null,
    p_entity_id_text: isText ? parsed.data.entityIdText ?? parsed.data.entityId ?? null : null,
  });
  if (error) return { ok: false, message: error.message };
  const row = Array.isArray(data) ? (data[0] as { conversation_id: string; context_id: string } | undefined) : null;
  if (!row) return { ok: false, message: "No se pudo resolver la conversación contextual." };
  return { ok: true, conversationId: row.conversation_id, contextId: row.context_id };
}
