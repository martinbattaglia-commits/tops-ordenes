// Nexus Link · lectura RC1.3: timeline contextual de una entidad desde Knowledge (D-RC1.3-3:
// EXCLUSIVAMENTE v_knowledge_entity_360, security_invoker → respeta RLS; NO modifica Knowledge).
// isMock()→seeds. entity_type = forma de Connect (plural), consistente con el adapter 0149.

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { ConnectEntityType } from "../types";
import { mockEntity360, type Entity360Event } from "../entity360-mock";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

const DEFAULT_LIMIT = 50;

export async function listEntity360(
  entityType: ConnectEntityType,
  entityId: string,
  limit = DEFAULT_LIMIT,
): Promise<Entity360Event[]> {
  if (isMock()) return mockEntity360(entityType, entityId);
  const supabase = createClient();
  if (!supabase) return mockEntity360(entityType, entityId);

  const { data, error } = await supabase
    .from("v_knowledge_entity_360")
    .select("event_id, seq, event_type, occurred_at, actor_label, summary")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[connect/listEntity360] query error:", error.message);
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      eventId: String(row.event_id), seq: Number(row.seq), eventType: row.event_type as string,
      occurredAt: row.occurred_at as string, actorLabel: (row.actor_label as string | null) ?? null,
      summary: (row.summary as string | null) ?? null,
    };
  });
}

export type { Entity360Event };
