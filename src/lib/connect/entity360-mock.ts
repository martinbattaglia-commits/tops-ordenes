// Nexus Link · seeds MOCK de RC1.3 (conversación contextual + Entity360) para render demo.
// Reusa MOCK_USERS de RC1.1. NO se usan en prod (allí se lee v_knowledge_entity_360 + las tablas).

import type { ConnectEntityType } from "./types";

export interface Entity360Event {
  eventId: string;
  seq: number;
  eventType: string;
  occurredAt: string;
  actorLabel: string | null;
  summary: string | null;
}

/** Conversación contextual mock por entidad (entity_type|entity_id → conversación). */
export interface MockEntityConversation {
  conversationId: string;
  contextId: string;
}

const NOW = "2026-06-30T12:00:00.000Z";
const T = (mins: number) => new Date(Date.parse(NOW) - mins * 60_000).toISOString();

/** Clave: `${entityType}:${entityId}`. La OS-2026-0142 demo reusa la conversación c-erp-1 de RC1.1. */
export const MOCK_ENTITY_CONVERSATIONS: Record<string, MockEntityConversation> = {
  "orders:00000000-0000-4000-8000-0000000000aa": { conversationId: "c-erp-1", contextId: "CTX-2026-000003" },
};

export const MOCK_ENTITY_360: Record<string, Entity360Event[]> = {
  "orders:00000000-0000-4000-8000-0000000000aa": [
    { eventId: "e1", seq: 5, eventType: "order.created", occurredAt: T(600), actorLabel: "Sistema", summary: "OS-2026-0142 creada" },
    { eventId: "e2", seq: 12, eventType: "order.signed", occurredAt: T(360), actorLabel: "Martín Battaglia", summary: "OS firmada" },
    { eventId: "e3", seq: 28, eventType: "connect.conversation_linked", occurredAt: T(150), actorLabel: "Martín Battaglia", summary: "Conversación vinculada (orders)" },
    { eventId: "e4", seq: 41, eventType: "order.dispatched", occurredAt: T(60), actorLabel: "Diego Fernández", summary: "Despacho coordinado" },
  ],
};

export function mockEntityConversation(entityType: ConnectEntityType, entityId: string): MockEntityConversation | null {
  return MOCK_ENTITY_CONVERSATIONS[`${entityType}:${entityId}`] ?? null;
}
export function mockEntity360(entityType: ConnectEntityType, entityId: string): Entity360Event[] {
  return MOCK_ENTITY_360[`${entityType}:${entityId}`] ?? [];
}
