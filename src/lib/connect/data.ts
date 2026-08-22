// Nexus Link · entidades FLAT (RC1.1): vínculos conversación↔entidad ERP (panel de contexto).
// Patrón knowledge/data.ts: isMock() → seeds; real → connect_conversation_links (RC1.0).

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { ConversationLink, ConnectEntityType } from "./types";
import { MOCK_LINKS } from "./mock";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

export async function listConversationLinks(conversationId: string): Promise<ConversationLink[]> {
  if (isMock()) return MOCK_LINKS[conversationId] ?? [];
  const supabase = createClient();
  if (!supabase) return MOCK_LINKS[conversationId] ?? [];
  const { data, error } = await supabase
    .from("connect_conversation_links")
    .select("id, conversation_id, entity_type, entity_id, entity_id_text, linked_by, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[connect/listConversationLinks] query error:", error.message);
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string, conversationId: row.conversation_id as string,
      entityType: row.entity_type as ConnectEntityType, entityId: row.entity_id as string | null,
      entityIdText: row.entity_id_text as string | null, linkedBy: row.linked_by as string | null,
      createdAt: row.created_at as string,
    };
  });
}

/** Id del usuario actual (real) o el mock en demo — para alinear "mensaje propio". */
export async function getCurrentUserId(): Promise<string | null> {
  if (isMock()) {
    const { MOCK_CURRENT_USER_ID } = await import("./mock");
    return MOCK_CURRENT_USER_ID;
  }
  const supabase = createClient();
  if (!supabase) {
    const { MOCK_CURRENT_USER_ID } = await import("./mock");
    return MOCK_CURRENT_USER_ID;
  }
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Id exacto del participante autenticado dentro de una conversación.
 *
 * No se infiere desde mensajes: un miembro puede reaccionar antes de haber
 * escrito. Cualquier fallo de autenticación, consulta o membresía queda
 * cerrado en null para que la superficie productiva no monte ThreadView.
 */
export async function getMyParticipantId(conversationId: string): Promise<string | null> {
  if (isMock()) {
    const { MOCK_PARTICIPANT_ID } = await import("./mock");
    return MOCK_PARTICIPANT_ID;
  }
  const supabase = createClient();
  if (!supabase) return null;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const uid = authData.user?.id;
  if (authError || !uid) return null;

  const { data: participant, error } = await supabase
    .from("connect_participants")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("profile_id", uid)
    .maybeSingle();

  if (error || typeof participant?.id !== "string" || participant.id.length === 0) {
    return null;
  }
  return participant.id;
}
