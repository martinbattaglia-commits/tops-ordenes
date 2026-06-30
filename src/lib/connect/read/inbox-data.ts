// Nexus Link · capa de LECTURA (RC1.1). Bandeja, conversación, mensajes (hilo), canales.
// Patrón canónico (knowledge/data.ts, rbac/data.ts): isMock() → seeds; createClient()→null → seeds;
// real → vistas security_invoker (v_connect_inbox/v_connect_channels) + tablas connect_* (RC1.0).
// Lectura por SESIÓN (RLS por membresía es la frontera). NUNCA service_role acá.

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type {
  Conversation, ConversationRow, InboxItem, InboxRow, Message, MessageRow, ChannelItem,
} from "../types";
import {
  mockInbox, mockChannels, MOCK_CONVERSATIONS, MOCK_MESSAGES,
} from "../mock";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

const MESSAGE_PAGE = 50;

// ───────────────────────── Mappers fila→dominio ─────────────────────────
function mapConversation(r: ConversationRow): Conversation {
  return {
    id: r.id, contextId: r.context_id, kind: r.kind, slug: r.slug, title: r.title,
    visibility: r.visibility, topic: r.topic, archivedAt: r.archived_at, createdBy: r.created_by,
    lastMessageSeq: r.last_message_seq, lastMessageAt: r.last_message_at, createdAt: r.created_at,
  };
}

function mapMessage(r: MessageRow): Message {
  return {
    id: r.id, conversationId: r.conversation_id, seq: r.seq,
    authorParticipantId: r.author_participant_id, authorProfileId: r.author_profile_id,
    kind: r.kind, body: r.body, bodyFormat: r.body_format, replyToMessageId: r.reply_to_message_id,
    editedAt: r.edited_at, deletedAt: r.deleted_at, redacted: r.redacted, createdAt: r.created_at,
  };
}

function mapInbox(r: InboxRow): InboxItem {
  return {
    conversationId: r.conversation_id, contextId: r.context_id, kind: r.kind, title: r.title,
    slug: r.slug, topic: r.topic, lastMessageAt: r.last_message_at, lastMessageSeq: r.last_message_seq,
    lastReadSeq: r.last_read_seq, unreadCount: r.unread_count, isFavorite: r.is_favorite,
    mutedUntil: r.muted_until, archivedAt: r.archived_at,
  };
}

// ───────────────────────── Lecturas ─────────────────────────

/** Bandeja unificada: mis conversaciones ordenadas por último mensaje. */
export async function listInbox(): Promise<InboxItem[]> {
  if (isMock()) return mockInbox();
  const supabase = createClient();
  if (!supabase) return mockInbox();
  const { data, error } = await supabase
    .from("v_connect_inbox")
    .select(
      "conversation_id, context_id, kind, title, slug, topic, last_message_at, last_message_seq, last_read_seq, unread_count, is_favorite, muted_until, archived_at",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) {
    console.error("[connect/listInbox] query error:", error.message);
    return [];
  }
  return (data ?? []).map((row) => mapInbox(row as InboxRow));
}

/** Una conversación por id (para el header del hilo). */
export async function getConversation(conversationId: string): Promise<Conversation | null> {
  if (isMock()) return MOCK_CONVERSATIONS.find((c) => c.id === conversationId) ?? null;
  const supabase = createClient();
  if (!supabase) return MOCK_CONVERSATIONS.find((c) => c.id === conversationId) ?? null;
  const { data, error } = await supabase
    .from("connect_conversations")
    .select(
      "id, context_id, kind, slug, title, visibility, topic, archived_at, created_by, last_message_seq, last_message_at, created_at",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !data) return null;
  return mapConversation(data as ConversationRow);
}

/**
 * Mensajes de una conversación (hilo). Paginación KEYSET por seq descendente
 * (estable ante inserciones concurrentes — contrato §6.2 del spec). Devuelve en
 * orden ascendente para render natural del hilo.
 */
export async function listMessages(
  conversationId: string,
  opts: { beforeSeq?: number; limit?: number } = {},
): Promise<Message[]> {
  const limit = opts.limit ?? MESSAGE_PAGE;
  if (isMock()) {
    const all = MOCK_MESSAGES[conversationId] ?? [];
    const filtered = opts.beforeSeq ? all.filter((m) => m.seq < opts.beforeSeq!) : all;
    return filtered.slice(-limit);
  }
  const supabase = createClient();
  if (!supabase) return MOCK_MESSAGES[conversationId] ?? [];
  let query = supabase
    .from("connect_messages")
    .select(
      "id, conversation_id, seq, author_participant_id, author_profile_id, kind, body, body_format, reply_to_message_id, edited_at, deleted_at, redacted, created_at",
    )
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: false })
    .limit(limit);
  if (opts.beforeSeq) query = query.lt("seq", opts.beforeSeq);
  const { data, error } = await query;
  if (error) {
    console.error("[connect/listMessages] query error:", error.message);
    return [];
  }
  // De desc (keyset) a asc (render del hilo).
  return (data ?? []).map((row) => mapMessage(row as MessageRow)).reverse();
}

/** Canales visibles (públicos o donde soy miembro). */
export async function listChannels(): Promise<ChannelItem[]> {
  if (isMock()) return mockChannels();
  const supabase = createClient();
  if (!supabase) return mockChannels();
  const { data, error } = await supabase
    .from("v_connect_channels")
    .select("id, context_id, slug, title, topic, visibility, last_message_at, is_member")
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) {
    console.error("[connect/listChannels] query error:", error.message);
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string, contextId: row.context_id as string, slug: row.slug as string | null,
      title: row.title as string | null, topic: row.topic as string | null,
      visibility: row.visibility as ChannelItem["visibility"], lastMessageAt: row.last_message_at as string | null,
      isMember: Boolean(row.is_member),
    };
  });
}
