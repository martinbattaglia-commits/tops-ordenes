import "server-only";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type {
  HealthSignals,
  QueueKpis,
  WorkerKpis,
  SourceKpi,
  DeadLetterEntry,
  KnowledgeAdminData,
} from "./admin-types";

/**
 * F0.5.2 / E2.3 — Capa de datos del Panel Administrativo de Knowledge.
 *
 * SOLO LECTURA (D-1): invoca las RPC SECDEF `knowledge_kpi_*` (0140), que tienen
 * gate interno `has_permission('knowledge.admin')` y cruzan la RLS para dar el
 * panorama TOTAL. Sin permiso → la RPC devuelve 0 filas → acá devolvemos null/[].
 * En demo/preview (isMock) degrada a vacío (G11). Nunca escribe.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

/** bigint de PostgREST puede llegar como string; coerción defensiva. */
function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

type Row = Record<string, unknown>;

export async function getHealthSignals(): Promise<HealthSignals | null> {
  if (isMock()) return null;
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("knowledge_kpi_health");
  if (error) {
    console.error("[knowledge/admin] health:", error.message);
    return null;
  }
  const row = (data as Row[] | null)?.[0];
  if (!row) return null;
  return {
    totalEvents: num(row.total_events),
    deadCount: num(row.dead_count),
    stuckCount: num(row.stuck_count),
    processingCount: num(row.processing_count),
    dueNow: num(row.due_now),
    oldestPendingAgeSeconds: numOrNull(row.oldest_pending_age_seconds),
    lastRunAt: str(row.last_run_at),
    lastNonDryRunAt: str(row.last_nondry_run_at),
  };
}

export async function getQueueKpis(): Promise<QueueKpis | null> {
  if (isMock()) return null;
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("knowledge_kpi_queue");
  if (error) {
    console.error("[knowledge/admin] queue:", error.message);
    return null;
  }
  const row = (data as Row[] | null)?.[0];
  if (!row) return null;
  return {
    pending: num(row.pending),
    processing: num(row.processing),
    failed: num(row.failed),
    dead: num(row.dead),
    processed: num(row.processed),
    total: num(row.total),
    dueNow: num(row.due_now),
    stuck: num(row.stuck),
    oldestPendingAgeSeconds: numOrNull(row.oldest_pending_age_seconds),
  };
}

export async function getWorkerKpis(windowHours = 24): Promise<WorkerKpis | null> {
  if (isMock()) return null;
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("knowledge_kpi_worker", {
    p_window: `${windowHours} hours`,
  });
  if (error) {
    console.error("[knowledge/admin] worker:", error.message);
    return null;
  }
  const row = (data as Row[] | null)?.[0];
  if (!row) return null;
  return {
    runs: num(row.runs),
    processed: num(row.processed),
    failedRetried: num(row.failed_retried),
    failedDead: num(row.failed_dead),
    avgDurationMs: numOrNull(row.avg_duration_ms),
    maxDurationMs: numOrNull(row.max_duration_ms),
    lastRunAt: str(row.last_run_at),
    lastNonDryRunAt: str(row.last_nondry_run_at),
    lastDry: row.last_dry == null ? null : Boolean(row.last_dry),
  };
}

export async function getSourceKpis(): Promise<SourceKpi[]> {
  if (isMock()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("knowledge_kpi_sources");
  if (error) {
    console.error("[knowledge/admin] sources:", error.message);
    return [];
  }
  return ((data as Row[] | null) ?? []).map((row) => ({
    sourceTable: String(row.source_table ?? ""),
    enabled: Boolean(row.enabled),
    lastBackfillAt: str(row.last_backfill_at),
    events: num(row.events),
    notes: str(row.notes),
  }));
}

export async function getDeadLetter(limit = 50): Promise<DeadLetterEntry[]> {
  if (isMock()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("knowledge_kpi_dead_letter", { p_limit: limit });
  if (error) {
    console.error("[knowledge/admin] dead_letter:", error.message);
    return [];
  }
  return ((data as Row[] | null) ?? []).map((row) => ({
    seq: num(row.seq),
    id: String(row.id ?? ""),
    eventType: String(row.event_type ?? ""),
    sourceTable: str(row.source_table),
    status: String(row.status ?? ""),
    retryCount: num(row.retry_count),
    error: str(row.error),
    availableAt: String(row.available_at ?? ""),
    occurredAt: String(row.occurred_at ?? ""),
  }));
}

/** Una pasada en paralelo para el panel. */
export async function getKnowledgeAdminData(): Promise<KnowledgeAdminData> {
  const [health, queue, worker, sources, deadLetter] = await Promise.all([
    getHealthSignals(),
    getQueueKpis(),
    getWorkerKpis(),
    getSourceKpis(),
    getDeadLetter(),
  ]);
  return { health, queue, worker, sources, deadLetter };
}
