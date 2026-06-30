import "server-only";

// Centro de Actividad (RC1.4) — feed cronológico. REUSA listTimeline (v_knowledge_timeline, Knowledge)
// SIN nueva infra (D-RC1.4-6 / Actividad). En demo, listTimeline()→[] → seeds locales para render.

import { env } from "@/lib/env";
import { listTimeline } from "@/lib/knowledge/data";
import type { TimelineEntry } from "@/lib/knowledge/types";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

export async function listActivity(limit = 40): Promise<TimelineEntry[]> {
  if (isMock()) return mockActivity();
  return listTimeline({ limit });
}

function mockActivity(): TimelineEntry[] {
  const now = Date.parse("2026-06-30T12:00:00.000Z");
  const T = (m: number) => new Date(now - m * 60_000).toISOString();
  const mk = (
    id: string, seq: number, eventType: string, mins: number, actor: string,
    entityType: string, entityId: string, summary: string,
  ): TimelineEntry => ({
    id, seq, eventType, occurredAt: T(mins), ingestedAt: T(mins),
    actorKind: "user", actorId: null, actorLabel: actor,
    entityType, entityId, summary, payload: {}, visibilityKey: "staff",
    sourceTable: null, correlationId: null,
  });
  return [
    mk("a1", 41, "connect.conversation_linked", 30, "Martín Battaglia", "orders", "00000000-0000-4000-8000-0000000000aa", "Conversación vinculada a OS-2026-0142"),
    mk("a2", 40, "order.dispatched", 60, "Diego Fernández", "orders", "00000000-0000-4000-8000-0000000000aa", "Despacho coordinado OS-2026-0142"),
    mk("a3", 39, "po.approved", 95, "María González", "purchase_orders", "po-1", "OC-2026-0348 aprobada"),
    mk("a4", 38, "recon.matched", 140, "Sistema", "recon", "rec-1", "Conciliación bancaria 100%"),
    mk("a5", 37, "order.signed", 360, "Martín Battaglia", "orders", "00000000-0000-4000-8000-0000000000aa", "OS-2026-0142 firmada"),
  ];
}
