// Nexus Link · seeds MOCK (RC1.1). Permiten renderizar bandeja + hilos en demo/preview SIN
// las migraciones 0142-0149 aplicadas. Mismo criterio que rbac/data.ts (SEED_ROLES): la capa
// de lectura devuelve estas constantes cuando isMock() es true. NO se usan en prod (allí leen
// las vistas/tablas reales cuando las migraciones estén aplicadas).

import type { Conversation, InboxItem, Message, ChannelItem, ConversationLink } from "./types";

/** Usuario actual ficticio (para no-leídos y "mensaje propio" en demo). */
export const MOCK_CURRENT_USER_ID = "00000000-0000-4000-8000-000000000001";

const NOW = "2026-06-30T12:00:00.000Z";
const T = (mins: number) => new Date(Date.parse(NOW) - mins * 60_000).toISOString();

interface MockUser {
  id: string;
  name: string;
  avatar: string;
}
export const MOCK_USERS: Record<string, MockUser> = {
  [MOCK_CURRENT_USER_ID]: { id: MOCK_CURRENT_USER_ID, name: "Martín Battaglia", avatar: "MB" },
  u2: { id: "00000000-0000-4000-8000-000000000002", name: "María González", avatar: "MG" },
  u3: { id: "00000000-0000-4000-8000-000000000003", name: "Diego Fernández", avatar: "DF" },
  u4: { id: "00000000-0000-4000-8000-000000000004", name: "Lucía Romero", avatar: "LR" },
};

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "c-dm-1", contextId: "CTX-2026-000001", kind: "dm", slug: null,
    title: "María González", visibility: null, topic: null, archivedAt: null,
    createdBy: MOCK_CURRENT_USER_ID, lastMessageSeq: 4, lastMessageAt: T(6), createdAt: T(240),
  },
  {
    id: "c-ch-1", contextId: "CTX-2026-000002", kind: "channel", slug: "operaciones-magaldi",
    title: "Operaciones Magaldi", visibility: "public", topic: "Coordinación diaria del depósito MAGALDI_1765",
    archivedAt: null, createdBy: MOCK_CURRENT_USER_ID, lastMessageSeq: 3, lastMessageAt: T(35), createdAt: T(1440),
  },
  {
    id: "c-erp-1", contextId: "CTX-2026-000003", kind: "erp", slug: null,
    title: "OS-2026-0142 · Coordinación de entrega", visibility: null, topic: null, archivedAt: null,
    createdBy: MOCK_CURRENT_USER_ID, lastMessageSeq: 2, lastMessageAt: T(90), createdAt: T(300),
  },
  {
    id: "c-inc-1", contextId: "CTX-2026-000004", kind: "incident", slug: null,
    title: "Avería montacargas sector D4", visibility: null, topic: null, archivedAt: null,
    createdBy: MOCK_USERS.u3.id, lastMessageSeq: 2, lastMessageAt: T(180), createdAt: T(200),
  },
];

const MOCK_PARTICIPANT_ID = "p-self";

function msg(
  conversationId: string, seq: number, authorId: string, body: string, minsAgo: number,
  replyTo: string | null = null,
): Message {
  const u = Object.values(MOCK_USERS).find((x) => x.id === authorId);
  return {
    id: `${conversationId}-m${seq}`, conversationId, seq,
    authorParticipantId: authorId === MOCK_CURRENT_USER_ID ? MOCK_PARTICIPANT_ID : `p-${authorId.slice(-1)}`,
    authorProfileId: authorId, authorName: u?.name ?? "—",
    kind: "text", body, bodyFormat: "markdown",
    replyToMessageId: replyTo, editedAt: null, deletedAt: null, redacted: false, createdAt: T(minsAgo),
  };
}

export const MOCK_MESSAGES: Record<string, Message[]> = {
  "c-dm-1": [
    msg("c-dm-1", 1, MOCK_USERS.u2.id, "Hola Martín, ¿confirmamos la recepción de mañana?", 60),
    msg("c-dm-1", 2, MOCK_CURRENT_USER_ID, "Sí, llega a las 9. ¿Tenés el remito?", 30),
    msg("c-dm-1", 3, MOCK_USERS.u2.id, "Lo subo al expediente y te etiqueto.", 12),
    msg("c-dm-1", 4, MOCK_USERS.u2.id, "Listo, quedó vinculado a la OC.", 6, "c-dm-1-m3"),
  ],
  "c-ch-1": [
    msg("c-ch-1", 1, MOCK_USERS.u3.id, "Arrancamos picking de la zona A.", 120),
    msg("c-ch-1", 2, MOCK_USERS.u4.id, "Falta personal en packing, ¿alguien suma?", 50),
    msg("c-ch-1", 3, MOCK_CURRENT_USER_ID, "Reasigno a dos del turno tarde.", 35),
  ],
  "c-erp-1": [
    msg("c-erp-1", 1, MOCK_CURRENT_USER_ID, "Conversación abierta desde la OS-2026-0142.", 150),
    msg("c-erp-1", 2, MOCK_USERS.u2.id, "El cliente pidió adelantar a la franja matutina.", 90),
  ],
  "c-inc-1": [
    msg("c-inc-1", 1, MOCK_USERS.u3.id, "Montacargas #3 fuera de servicio, freno hidráulico.", 200),
    msg("c-inc-1", 2, MOCK_USERS.u4.id, "Aviso a mantenimiento, ETA 2hs.", 180),
  ],
};

export const MOCK_LINKS: Record<string, ConversationLink[]> = {
  "c-erp-1": [
    {
      id: "l-1", conversationId: "c-erp-1", entityType: "orders",
      entityId: "00000000-0000-4000-8000-0000000000aa", entityIdText: null,
      linkedBy: MOCK_CURRENT_USER_ID, createdAt: T(150),
    },
  ],
};

export function mockInbox(): InboxItem[] {
  return MOCK_CONVERSATIONS.map((c) => {
    const msgs = MOCK_MESSAGES[c.id] ?? [];
    // No-leídos demo: en el DM marcamos 1 sin leer; el resto leídos.
    const lastReadSeq = c.id === "c-dm-1" ? 3 : c.lastMessageSeq ?? 0;
    return {
      conversationId: c.id, contextId: c.contextId, kind: c.kind, title: c.title, slug: c.slug,
      topic: c.topic, lastMessageAt: c.lastMessageAt, lastMessageSeq: c.lastMessageSeq,
      lastReadSeq, unreadCount: Math.max((c.lastMessageSeq ?? 0) - lastReadSeq, 0),
      isFavorite: c.id === "c-ch-1", mutedUntil: null, archivedAt: c.archivedAt,
    };
  }).sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
}

export function mockChannels(): ChannelItem[] {
  return MOCK_CONVERSATIONS.filter((c) => c.kind === "channel").map((c) => ({
    id: c.id, contextId: c.contextId, slug: c.slug, title: c.title, topic: c.topic,
    visibility: c.visibility, lastMessageAt: c.lastMessageAt, isMember: true,
  }));
}
