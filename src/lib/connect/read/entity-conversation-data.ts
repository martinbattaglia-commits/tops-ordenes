// Nexus Link · lectura RC1.3: resuelve la conversación contextual PRINCIPAL de una entidad ERP
// (read-only; el get-or-create-write lo hace el RPC 0152 vía action). isMock()→seeds.

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { ConnectEntityType } from "../types";
import { usesTextPk } from "../domain/entity-conversation";
import { mockEntityConversation } from "../entity360-mock";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

export interface EntityConversationRef {
  conversationId: string;
  contextId: string;
}

/** La conversación 'erp' principal (más antigua) vinculada a la entidad, o null si no existe. */
export async function getEntityConversation(
  entityType: ConnectEntityType,
  entityId: string,
): Promise<EntityConversationRef | null> {
  if (isMock()) return mockEntityConversation(entityType, entityId);
  const supabase = createClient();
  if (!supabase) return mockEntityConversation(entityType, entityId);

  const col = usesTextPk(entityType) ? "entity_id_text" : "entity_id";
  const { data: links, error: lErr } = await supabase
    .from("connect_conversation_links")
    .select("conversation_id")
    .eq("entity_type", entityType)
    .eq(col, entityId);
  if (lErr || !links || links.length === 0) return null;

  const ids = (links as Array<{ conversation_id: string }>).map((l) => l.conversation_id);
  const { data: conv, error: cErr } = await supabase
    .from("connect_conversations")
    .select("id, context_id, created_at")
    .in("id", ids)
    .eq("kind", "erp")
    // Desempate determinístico idéntico al RPC 0152 (created_at asc, id asc): si dos conversaciones
    // 'erp' comparten created_at, read y write deben resolver la MISMA principal (D-RC1.3-1).
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (cErr || !conv) return null;
  const row = conv as { id: string; context_id: string };
  return { conversationId: row.id, contextId: row.context_id };
}
