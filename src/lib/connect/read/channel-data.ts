// Nexus Link · lectura RC1.2 (canales/miembros/fijados). isMock()→seeds; real→tablas/vistas RC1.0.
// Reusa listChannels/mockChannels de RC1.1 (import, sin modificar).

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { ChannelItem, MemberRole } from "../types";
import { listChannels, mapChannel, CHANNEL_VIEW_COLS } from "./inbox-data";
import { mockChannels } from "../mock";
import {
  MOCK_EXTRA_CHANNELS, MOCK_MEMBERS, MOCK_MY_ROLE, MOCK_PINNED,
  type ChannelMember, type PinnedItem,
} from "../channel-mock";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

/** Directorio de canales: visibles (públicos o donde soy miembro). Excluye archivados (DEFECT-6). */
export async function listChannelDirectory(): Promise<ChannelItem[]> {
  if (isMock()) return [...mockChannels(), ...MOCK_EXTRA_CHANNELS].filter((c) => !c.archivedAt);
  return listChannels(); // v_connect_channels (RC1.1) — filtra archived_at en el loader
}

/**
 * Un canal por slug INCLUYENDO archivados (DEFECT-6): la ruta /canales/[slug] lo usa para
 * poder mostrar la vista read-only "Archivado" en acceso por URL directa. A diferencia del
 * directorio, NO filtra archived_at. La RLS de connect_conversations sigue siendo la frontera.
 */
export async function getChannelBySlug(slug: string): Promise<ChannelItem | null> {
  if (isMock()) return [...mockChannels(), ...MOCK_EXTRA_CHANNELS].find((c) => c.slug === slug) ?? null;
  const supabase = createClient();
  if (!supabase) return [...mockChannels(), ...MOCK_EXTRA_CHANNELS].find((c) => c.slug === slug) ?? null;
  const { data, error } = await supabase
    .from("v_connect_channels")
    .select(CHANNEL_VIEW_COLS)
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return mapChannel(data as Record<string, unknown>);
}

/**
 * Miembros de una conversación (panel).
 * DEFECT-2 (piloto F3): resuelve `profile_id → full_name` vía `profiles_public`
 * (SECDEF view id+full_name) para mostrar identidad humana en vez del UUID.
 */
export async function listParticipants(conversationId: string): Promise<ChannelMember[]> {
  if (isMock()) return MOCK_MEMBERS[conversationId] ?? [];
  const supabase = createClient();
  if (!supabase) return MOCK_MEMBERS[conversationId] ?? [];
  const { data, error } = await supabase
    .from("connect_participants")
    .select("profile_id, member_role, participant_type")
    .eq("conversation_id", conversationId)
    .order("joined_at", { ascending: true });
  if (error) {
    console.error("[connect/listParticipants] query error:", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // Resolución de nombres (DEFECT-2): 1 query batch a profiles_public por los ids presentes.
  const ids = Array.from(
    new Set(rows.map((r) => r.profile_id as string | null).filter((v): v is string => !!v))
  );
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs, error: perr } = await supabase
      .from("profiles_public")
      .select("id, full_name")
      .in("id", ids);
    if (perr) {
      console.error("[connect/listParticipants] profiles_public error:", perr.message);
    } else {
      for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
        const n = (p.full_name ?? "").trim();
        if (n) nameById.set(p.id, n);
      }
    }
  }

  return rows.map((row) => {
    const pid = row.profile_id as string | null;
    return {
      profileId: pid,
      name: (pid ? nameById.get(pid) : undefined) ?? null,
      avatar: null,
      memberRole: row.member_role as MemberRole,
      participantType: row.participant_type as ChannelMember["participantType"],
    };
  });
}

/** Rol del usuario actual en la conversación (habilita moderación). */
export async function getMyRole(conversationId: string): Promise<MemberRole | null> {
  if (isMock()) return MOCK_MY_ROLE[conversationId] ?? null;
  const supabase = createClient();
  if (!supabase) return MOCK_MY_ROLE[conversationId] ?? null;
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return null;
  const { data: row } = await supabase
    .from("connect_participants")
    .select("member_role")
    .eq("conversation_id", conversationId)
    .eq("profile_id", uid)
    .maybeSingle();
  return (row?.member_role as MemberRole) ?? null;
}

/** Mensajes fijados de la conversación. */
export async function listPinned(conversationId: string): Promise<PinnedItem[]> {
  if (isMock()) return MOCK_PINNED[conversationId] ?? [];
  const supabase = createClient();
  if (!supabase) return MOCK_PINNED[conversationId] ?? [];
  const { data, error } = await supabase
    .from("connect_pinned")
    .select("id, message_id, pinned_at, message:connect_messages(body)")
    .eq("conversation_id", conversationId)
    .order("pinned_at", { ascending: false });
  if (error) {
    console.error("[connect/listPinned] query error:", error.message);
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const msg = row.message as { body?: string | null } | null;
    return {
      id: row.id as string, messageId: row.message_id as string,
      body: msg?.body ?? null, authorName: null, pinnedAt: row.pinned_at as string,
    };
  });
}
