// Nexus Link · seeds MOCK de RC1.2 (canales/miembros/fijados) para render demo. Reusa MOCK_USERS de
// RC1.1 (import, sin modificar). NO se usan en prod.

import type { ChannelItem, MemberRole, ParticipantType } from "./types";
import { MOCK_USERS, MOCK_CURRENT_USER_ID } from "./mock";

export interface ChannelMember {
  profileId: string | null;
  name: string | null;
  avatar: string | null;
  memberRole: MemberRole;
  participantType: ParticipantType;
}

export interface PinnedItem {
  id: string;
  messageId: string;
  body: string | null;
  authorName: string | null;
  pinnedAt: string;
}

const NOW = "2026-06-30T12:00:00.000Z";
const T = (mins: number) => new Date(Date.parse(NOW) - mins * 60_000).toISOString();

/** Canales públicos extra (directorio demo) — el usuario NO es miembro (muestra "Unirse"). */
export const MOCK_EXTRA_CHANNELS: ChannelItem[] = [
  {
    id: "c-ch-2", contextId: "CTX-2026-000010", slug: "anuncios", title: "Anuncios",
    topic: "Comunicados de Dirección a todo el staff", visibility: "public",
    lastMessageAt: T(300), isMember: false, archivedAt: null,
  },
  {
    id: "c-ch-3", contextId: "CTX-2026-000011", slug: "compras-proveedores", title: "Compras · Proveedores",
    topic: "Coordinación de OC y proveedores", visibility: "public",
    lastMessageAt: T(600), isMember: false, archivedAt: null,
  },
];

function member(userKey: keyof typeof MOCK_USERS | string, role: MemberRole): ChannelMember {
  const u = MOCK_USERS[userKey as keyof typeof MOCK_USERS];
  return {
    profileId: u?.id ?? null, name: u?.name ?? null, avatar: u?.avatar ?? null,
    memberRole: role, participantType: "staff",
  };
}

export const MOCK_MEMBERS: Record<string, ChannelMember[]> = {
  "c-ch-1": [
    member(MOCK_CURRENT_USER_ID, "owner"),
    member("u3", "moderator"),
    member("u4", "member"),
    member("u2", "member"),
  ],
  "c-erp-1": [member(MOCK_CURRENT_USER_ID, "owner"), member("u2", "member")],
  "c-dm-1": [member(MOCK_CURRENT_USER_ID, "member"), member("u2", "member")],
};

/** Rol del usuario actual por conversación (demo) → habilita/oculta moderación. */
export const MOCK_MY_ROLE: Record<string, MemberRole> = {
  "c-ch-1": "owner",
  "c-erp-1": "owner",
  "c-dm-1": "member",
};

export const MOCK_PINNED: Record<string, PinnedItem[]> = {
  "c-ch-1": [
    {
      id: "pin-1", messageId: "c-ch-1-m3", body: "Reasigno a dos del turno tarde.",
      authorName: "Martín Battaglia", pinnedAt: T(30),
    },
  ],
};
