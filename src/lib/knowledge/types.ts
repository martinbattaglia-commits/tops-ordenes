/** Discriminador de visibilidad (Parte II §B 1.2 / Parte III §4.1). */
export type VisibilityKey = "public_auth" | "staff" | `client:${string}` | `perm:${string}`;

export type ActorKind = "user" | "system" | "integration";

/** Fila del read-model del timeline (espeja public.v_knowledge_timeline). */
export interface KnowledgeEvent {
  id: string;
  seq: number;
  eventType: string;
  occurredAt: string;
  ingestedAt: string;
  actorKind: ActorKind;
  actorId: string | null;
  actorLabel: string | null;
  entityType: string;
  entityId: string;
  summary: string | null;
  payload: Record<string, unknown>;
  visibilityKey: string;
  sourceTable: string | null;
  correlationId: string | null;
}

/** Entrada de timeline para la UI. */
export interface TimelineEntry extends KnowledgeEvent {}

/** Scope de consulta del timeline. */
export interface TimelineScope {
  entityType?: string;
  entityId?: string;
  limit?: number;
}
