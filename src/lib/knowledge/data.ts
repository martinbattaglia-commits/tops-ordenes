import "server-only";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { TimelineEntry, TimelineScope } from "./types";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

/** Fila raw de v_knowledge_timeline (snake_case). */
interface TimelineRow {
  id: string;
  seq: number;
  event_type: string;
  occurred_at: string;
  ingested_at: string;
  actor_kind: string;
  actor_id: string | null;
  actor_label: string | null;
  entity_type: string;
  entity_id: string;
  summary: string | null;
  payload: Record<string, unknown> | null;
  visibility_key: string;
  source_table: string | null;
  correlation_id: string | null;
}

/**
 * Convierte una fila snake_case de v_knowledge_timeline al TimelineEntry camelCase.
 * Puro (sin IO): testeable unitariamente.
 */
export function mapTimelineRow(row: TimelineRow): TimelineEntry {
  return {
    id: row.id,
    seq: row.seq,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    ingestedAt: row.ingested_at,
    actorKind: row.actor_kind as TimelineEntry["actorKind"],
    actorId: row.actor_id ?? null,
    actorLabel: row.actor_label ?? null,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary ?? null,
    payload: row.payload ?? {},
    visibilityKey: row.visibility_key,
    sourceTable: row.source_table ?? null,
    correlationId: row.correlation_id ?? null,
  };
}

const DEFAULT_LIMIT = 100;

/**
 * Lee el timeline corporativo unificado desde v_knowledge_timeline.
 * En demo/preview devuelve [] (G11). Degrada a [] en error de query.
 * D12: SOLO LECTURA — ninguna escritura desde TS.
 */
export async function listTimeline(scope: TimelineScope = {}): Promise<TimelineEntry[]> {
  if (isMock()) return [];
  const supabase = createClient();
  if (!supabase) return [];

  let query = supabase
    .from("v_knowledge_timeline")
    .select(
      "id, seq, event_type, occurred_at, ingested_at, actor_kind, actor_id, actor_label, entity_type, entity_id, summary, payload, visibility_key, source_table, correlation_id"
    )
    .order("seq", { ascending: false })
    .limit(scope.limit ?? DEFAULT_LIMIT);

  if (scope.entityType) {
    query = query.eq("entity_type", scope.entityType);
  }
  if (scope.entityId) {
    query = query.eq("entity_id", scope.entityId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[knowledge/listTimeline] query error:", error.message);
    return [];
  }

  return (data ?? []).map((row) => mapTimelineRow(row as TimelineRow));
}
