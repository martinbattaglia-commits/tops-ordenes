// Nexus Link · Lectura del buzón / hilos (RC1.0 / P1 / P2 / P3). Funciones puras de read model.
// En demo mode o tests sin Supabase configurado, usa MOCK_* para no romper SSR.

import { createClient } from "@/lib/supabase/server";
import { projectWaMessage } from "../realtime-status";
import type {
  Conversation,
  Message,
  ChannelItem,
  InboxItem,
  ConversationRow,
  MessageRow,
  InboxRow,
  MessageReaction,
} from "../types";
import { env } from "@/lib/env";
import {
  mockInbox, mockChannels, MOCK_CONVERSATIONS, MOCK_MESSAGES,
} from "../mock";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

const MESSAGE_PAGE = 50;

export function mapConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    contextId: r.context_id,
    kind: r.kind,
    slug: r.slug,
    title: r.title,
    visibility: r.visibility,
    topic: r.topic,
    archivedAt: r.archived_at,
    createdBy: r.created_by,
    lastMessageSeq: r.last_message_seq,
    lastMessageAt: r.last_message_at,
    createdAt: r.created_at,
    handoverState: r.handover_state ?? undefined,
  };
}

/**
 * Mapea una fila de `connect_messages` a la interfaz `Message` del cliente.
 */
function mapMessage(r: MessageRow, myParticipantId?: string | null): Message {
  const rawReactions = r.connect_message_reactions ?? [];
  const reactionMap = new Map<string, { count: number; myReaction: boolean; ids: string[] }>();
  for (const rx of rawReactions) {
    const existing = reactionMap.get(rx.emoji) ?? { count: 0, myReaction: false, ids: [] };
    existing.count += 1;
    if (myParticipantId && rx.participant_id === myParticipantId) {
      existing.myReaction = true;
    }
    existing.ids.push(rx.id);
    reactionMap.set(rx.emoji, existing);
  }
  const reactions: MessageReaction[] = Array.from(reactionMap.entries()).map(([emoji, data]) => ({
    id: data.ids[0] ?? emoji,
    emoji,
    count: data.count,
    myReaction: data.myReaction,
  }));

  return {
    id: r.id,
    conversationId: r.conversation_id,
    seq: r.seq,
    authorParticipantId: r.author_participant_id,
    authorProfileId: r.author_profile_id,
    kind: r.kind,
    body: r.body,
    bodyFormat: r.body_format,
    replyToMessageId: r.reply_to_message_id,
    editedAt: r.edited_at,
    deletedAt: r.deleted_at,
    redacted: r.redacted,
    createdAt: r.created_at,
    wa: projectWaMessage({ meta: r.meta, externalMsgId: r.external_msg_id }),
    attachments: (r.connect_attachments ?? []).map((a) => ({
      id: a.id,
      fileName: a.file_name,
      mimeType: a.mime_type,
      fileSize: a.file_size === null || a.file_size === undefined ? null : Number(a.file_size),
      scanStatus: a.scan_status ?? "",
    })),
    reactions: reactions.length > 0 ? reactions : undefined,
  };
}

function mapInbox(r: InboxRow): InboxItem {
  return {
    conversationId: r.conversation_id,
    contextId: r.context_id,
    kind: r.kind,
    title: r.title,
    slug: r.slug,
    topic: r.topic,
    lastMessageAt: r.last_message_at,
    lastMessageSeq: r.last_message_seq,
    lastReadSeq: r.last_read_seq,
    unreadCount: r.unread_count,
    isFavorite: r.is_favorite,
    mutedUntil: r.muted_until,
    archivedAt: r.archived_at,
  };
}

export const CHANNEL_VIEW_COLS = "id, context_id, slug, title, topic, visibility, last_message_at, is_member, archived_at";

export function mapChannel(r: Record<string, unknown>): ChannelItem {
  return {
    id: r.id as string,
    contextId: (r.context_id as string) ?? "",
    slug: (r.slug as string) ?? null,
    title: (r.title as string) ?? null,
    topic: (r.topic as string) ?? null,
    visibility: (r.visibility as "public" | "private") ?? null,
    lastMessageAt: (r.last_message_at as string) ?? null,
    isMember: Boolean(r.is_member),
    archivedAt: (r.archived_at as string) ?? null,
  };
}

/**
 * Lista de conversaciones en la bandeja (v_connect_inbox).
 */
export async function listInbox(opts: { archived?: boolean } = {}): Promise<InboxItem[]> {
  const archived = opts.archived ?? false;
  if (isMock()) return mockInbox().filter((i) => (i.archivedAt != null) === archived);
  const supabase = createClient();
  if (!supabase) return mockInbox().filter((i) => (i.archivedAt != null) === archived);
  let query = supabase
    .from("v_connect_inbox")
    .select(
      "conversation_id, context_id, kind, title, slug, topic, last_message_at, last_message_seq, last_read_seq, unread_count, is_favorite, muted_until, archived_at",
    );
  query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  const { data, error } = await query.order("last_message_at", {
    ascending: false,
    nullsFirst: false,
  });
  if (error) {
    console.error("[connect/listInbox] query error:", error.message);
    return [];
  }
  const items = (data ?? []).map((row) => mapInbox(row as InboxRow));
  return withDmNames(supabase, items);
}

/**
 * UX-002c: los DM guardan title NULL — la bandeja debe mostrar el nombre de la
 * contraparte.
 */
async function withDmNames(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  items: InboxItem[],
): Promise<InboxItem[]> {
  const dmIds = items.filter((i) => i.kind === "dm" && !i.title).map((i) => i.conversationId);
  if (dmIds.length === 0) return items;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return items;
  const { data: parts, error } = await supabase
    .from("connect_participants")
    .select("conversation_id, profile_id")
    .in("conversation_id", dmIds)
    .neq("profile_id", user.id);
  if (error || !parts) return items;
  const otherByConv = new Map<string, string>();
  for (const p of parts as Array<{ conversation_id: string; profile_id: string }>) {
    if (!otherByConv.has(p.conversation_id)) otherByConv.set(p.conversation_id, p.profile_id);
  }
  const profileIds = Array.from(new Set(otherByConv.values()));
  if (profileIds.length === 0) return items;
  const { data: profs } = await supabase
    .from("profiles_public")
    .select("id, full_name")
    .in("id", profileIds);
  const names = new Map(
    ((profs ?? []) as Array<{ id: string; full_name: string | null }>)
      .map((p) => [p.id, (p.full_name ?? "").trim()]),
  );
  return items.map((i) => {
    const other = otherByConv.get(i.conversationId);
    const name = other ? names.get(other) : undefined;
    return name ? { ...i, title: name } : i;
  });
}

/** Una conversación por id (para el header del hilo). */
export async function getConversation(conversationId: string): Promise<Conversation | null> {
  if (isMock()) return MOCK_CONVERSATIONS.find((c) => c.id === conversationId) ?? null;
  const supabase = createClient();
  if (!supabase) return MOCK_CONVERSATIONS.find((c) => c.id === conversationId) ?? null;
  const { data, error } = await supabase
    .from("connect_conversations")
    .select(
      "id, context_id, kind, slug, title, visibility, topic, archived_at, created_by, last_message_seq, last_message_at, created_at, handover_state",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !data) return null;
  return mapConversation(data as ConversationRow);
}

/**
 * Mensajes de una conversación (hilo). Paginación KEYSET por seq descendente.
 * Devuelve en orden ascendente para render natural del hilo.
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

  // Resolver mi participantId para saber si reaccioné
  let myParticipantId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: myPart } = await supabase
        .from("connect_participants")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("profile_id", user.id)
        .maybeSingle();
      if (myPart?.id) myParticipantId = myPart.id;
    }
  } catch {
    // best-effort
  }

  let query = supabase
    .from("connect_messages")
    .select(
      "id, conversation_id, seq, author_participant_id, author_profile_id, kind, body, body_format, reply_to_message_id, edited_at, deleted_at, redacted, created_at, meta, external_msg_id, connect_attachments(id, file_name, mime_type, file_size, scan_status), connect_message_reactions(id, emoji, participant_id, created_at)",
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
  const items = (data ?? []).map((row) => mapMessage(row as MessageRow, myParticipantId)).reverse();
  return withAuthorNames(supabase, conversationId, items);
}

/**
 * WA-002 / P2 / P3: puebla `authorName`, `authorAvatarUrl`, y `replyToMessage`.
 */
async function withAuthorNames(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  conversationId: string,
  items: Message[],
): Promise<Message[]> {
  if (items.length === 0) return items;
  const { data: parts, error } = await supabase
    .from("connect_participants")
    .select("id, profile_id, external_ref")
    .eq("conversation_id", conversationId);
  if (error || !parts) return items;
  const rows = parts as Array<{
    id: string; profile_id: string | null;
    external_ref: { display_name?: string; author?: string; avatar_url?: string } | null;
  }>;
  const nameByPart = new Map<string, string>();
  const avatarByPart = new Map<string, string | null>();
  const profileIds: string[] = [];
  for (const p of rows) {
    const ext = (p.external_ref?.display_name ?? p.external_ref?.author ?? "").trim();
    if (ext) nameByPart.set(p.id, ext);
    if (p.external_ref?.avatar_url) avatarByPart.set(p.id, p.external_ref.avatar_url);
    if (p.profile_id) profileIds.push(p.profile_id);
  }
  const nameByProfile = new Map<string, string>();
  const avatarByProfile = new Map<string, string | null>();
  if (profileIds.length > 0) {
    try {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", profileIds);
      for (const p of ((profs ?? []) as Array<{ id: string; full_name: string | null; avatar_url?: string | null }>)) {
        const n = (p.full_name ?? "").trim();
        if (n) nameByProfile.set(p.id, n);
        if (p.avatar_url) avatarByProfile.set(p.id, p.avatar_url);
      }
    } catch {
      // Fallback a profiles_public si profiles select falla
      const { data: profsPub } = await supabase
        .from("profiles_public")
        .select("id, full_name")
        .in("id", profileIds);
      for (const p of ((profsPub ?? []) as Array<{ id: string; full_name: string | null }>)) {
        const n = (p.full_name ?? "").trim();
        if (n) nameByProfile.set(p.id, n);
      }
    }
  }
  const partProfile = new Map(rows.map((p) => [p.id, p.profile_id] as const));
  const messageById = new Map(items.map((m) => [m.id, m]));

  return items.map((m) => {
    let name = m.authorName;
    let avatarUrl: string | null = m.authorAvatarUrl ?? null;
    if (m.authorParticipantId) {
      if (!name) name = nameByPart.get(m.authorParticipantId);
      if (!avatarUrl) avatarUrl = avatarByPart.get(m.authorParticipantId) ?? null;
      const pid = partProfile.get(m.authorParticipantId);
      if (pid) {
        if (!name) name = nameByProfile.get(pid);
        if (!avatarUrl) avatarUrl = avatarByProfile.get(pid) ?? null;
      }
    }
    if (m.authorProfileId) {
      if (!name) name = nameByProfile.get(m.authorProfileId);
      if (!avatarUrl) avatarUrl = avatarByProfile.get(m.authorProfileId) ?? null;
    }

    let replyToMessage = m.replyToMessage ?? null;
    if (m.replyToMessageId && !replyToMessage) {
      const parent = messageById.get(m.replyToMessageId);
      if (parent) {
        replyToMessage = {
          id: parent.id,
          authorName: parent.authorName ?? null,
          body: parent.body ?? null,
        };
      }
    }

    return {
      ...m,
      authorName: name ?? m.authorName ?? null,
      authorAvatarUrl: avatarUrl,
      replyToMessage,
    };
  });
}

/** Canales visibles (públicos o donde soy miembro). */
export async function listChannels(): Promise<ChannelItem[]> {
  if (isMock()) return mockChannels();
  const supabase = createClient();
  if (!supabase) return mockChannels();
  const { data, error } = await supabase
    .from("v_connect_channels")
    .select(CHANNEL_VIEW_COLS)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) {
    console.error("[connect/listChannels] query error:", error.message);
    return [];
  }
  return (data ?? []).map((r) => mapChannel(r as Record<string, unknown>));
}
