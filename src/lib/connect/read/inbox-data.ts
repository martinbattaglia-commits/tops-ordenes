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
import { projectWaMessage } from "../realtime-status";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

const MESSAGE_PAGE = 50;

// ───────────────────────── Mappers fila→dominio ─────────────────────────
export function mapConversation(r: ConversationRow): Conversation {
  return {
    id: r.id, contextId: r.context_id, kind: r.kind, slug: r.slug, title: r.title,
    visibility: r.visibility, topic: r.topic, archivedAt: r.archived_at, createdBy: r.created_by,
    lastMessageSeq: r.last_message_seq, lastMessageAt: r.last_message_at, createdAt: r.created_at,
    handoverState: r.handover_state ?? undefined,
  };
}

/**
 * WA-8R3 · B · HIDRATACIÓN SANITIZADA.
 *
 * `meta` y `external_msg_id` se leen SÓLO para derivar la proyección y se
 * descartan acá: el objeto que viaja al cliente no los contiene, ni contiene
 * wamid, payloads del proveedor, tokens, teléfonos ni errores internos.
 *
 * La proyección se adjunta SIEMPRE en la lectura real. Su presencia es lo que
 * distingue «el servidor miró esta fila» de una burbuja optimista local, y por
 * eso un mensaje hidratado sin evidencia afirmativa no puede mostrarse
 * confirmado sólo porque su estado visual sea `undefined`.
 *
 * Es sólo lectura: no escribe ni modifica filas.
 */
function mapMessage(r: MessageRow): Message {
  return {
    id: r.id, conversationId: r.conversation_id, seq: r.seq,
    authorParticipantId: r.author_participant_id, authorProfileId: r.author_profile_id,
    kind: r.kind, body: r.body, bodyFormat: r.body_format, replyToMessageId: r.reply_to_message_id,
    editedAt: r.edited_at, deletedAt: r.deleted_at, redacted: r.redacted, createdAt: r.created_at,
    wa: projectWaMessage({ meta: r.meta, externalMsgId: r.external_msg_id }),
    // H-1 · el adjunto viaja con su mensaje. Sin `storage_path`: la ubicación
    // del objeto la resuelve el portón, no el navegador.
    attachments: (r.connect_attachments ?? []).map((a) => ({
      id: a.id,
      fileName: a.file_name,
      mimeType: a.mime_type,
      // `file_size` es bigint: PostgREST lo entrega como número o como string
      // según el tamaño, y un `null` no debe convertirse en 0 —que mentiría
      // diciendo «archivo vacío»—.
      fileSize: a.file_size === null || a.file_size === undefined ? null : Number(a.file_size),
      scanStatus: a.scan_status ?? "",
    })),
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

/** Fila de v_connect_channels → ChannelItem. Compartido por listChannels y getChannelBySlug. */
export function mapChannel(r: Record<string, unknown>): ChannelItem {
  return {
    id: r.id as string, contextId: r.context_id as string, slug: r.slug as string | null,
    title: r.title as string | null, topic: r.topic as string | null,
    visibility: r.visibility as ChannelItem["visibility"], lastMessageAt: r.last_message_at as string | null,
    isMember: Boolean(r.is_member), archivedAt: (r.archived_at as string | null) ?? null,
  };
}

/** Columnas de v_connect_channels (incluye archived_at desde 0159). */
export const CHANNEL_VIEW_COLS =
  "id, context_id, slug, title, topic, visibility, last_message_at, is_member, archived_at";

// ───────────────────────── Lecturas ─────────────────────────

/**
 * Bandeja unificada: mis conversaciones ordenadas por último mensaje.
 * UX-002: `archived` invierte el único predicado de estado (`archived_at`) sobre
 * la MISMA vista security_invoker — misma membresía, misma RLS, sin superficie nueva.
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
  // DEFECT-6 (piloto F3): la bandeja activa excluye archivadas; UX-002 agrega la inversa.
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
 * contraparte. Nombres vía profiles_public (lockdown 0040 / lección I-1), misma
 * técnica que tasks/incidents-data. Best-effort: si algo falla, queda el fallback.
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
      // `meta` y `external_msg_id` entran SÓLO para derivar la proyección
      // sanitizada en `mapMessage`; no se propagan al cliente.
      // H-1 · el join trae el adjunto con el mensaje. La RLS de
      // `connect_attachments` ya exige membresía + canal permitido, así que el
      // embebido no amplía lo que el usuario puede ver: si no puede leer el
      // adjunto, la lista embebida le llega vacía.
      "id, conversation_id, seq, author_participant_id, author_profile_id, kind, body, body_format, reply_to_message_id, edited_at, deleted_at, redacted, created_at, meta, external_msg_id, connect_attachments(id, file_name, mime_type, file_size, scan_status)",
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
  const items = (data ?? []).map((row) => mapMessage(row as MessageRow)).reverse();
  return withAuthorNames(supabase, conversationId, items);
}

/**
 * WA-002 F1a: puebla `authorName` (el campo ya existía en el tipo y ThreadView ya lo
 * renderiza — nunca se llenaba). Autores con perfil → profiles_public; autores externos
 * (participant_type 'whatsapp') → external_ref.display_name. Best-effort: ante error,
 * los mensajes salen sin nombre (comportamiento previo).
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
    external_ref: { display_name?: string; author?: string } | null;
  }>;
  const nameByPart = new Map<string, string>();
  const profileIds: string[] = [];
  for (const p of rows) {
    const ext = (p.external_ref?.display_name ?? p.external_ref?.author ?? "").trim();
    if (ext) nameByPart.set(p.id, ext);
    else if (p.profile_id) profileIds.push(p.profile_id);
  }
  const nameByProfile = new Map<string, string>();
  if (profileIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles_public")
      .select("id, full_name")
      .in("id", profileIds);
    for (const p of ((profs ?? []) as Array<{ id: string; full_name: string | null }>)) {
      const n = (p.full_name ?? "").trim();
      if (n) nameByProfile.set(p.id, n);
    }
  }
  const partProfile = new Map(rows.map((p) => [p.id, p.profile_id] as const));
  return items.map((m) => {
    if (m.authorName) return m;
    let name: string | undefined;
    if (m.authorParticipantId) {
      name = nameByPart.get(m.authorParticipantId);
      if (!name) {
        const pid = partProfile.get(m.authorParticipantId);
        if (pid) name = nameByProfile.get(pid);
      }
    }
    if (!name && m.authorProfileId) name = nameByProfile.get(m.authorProfileId);
    return name ? { ...m, authorName: name } : m;
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
    // DEFECT-6 (piloto F3): el directorio de canales activos excluye archivados.
    .is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) {
    console.error("[connect/listChannels] query error:", error.message);
    return [];
  }
  return (data ?? []).map((r) => mapChannel(r as Record<string, unknown>));
}
