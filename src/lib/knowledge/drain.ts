import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * F0.5.2 / E2.1 — Worker de drenado de la cola de Knowledge.
 *
 * Reclama lotes de eventos `pending`/`failed` due (vía RPC con FOR UPDATE SKIP LOCKED),
 * ejecuta el procesador, transiciona estados (processed | failed+backoff | dead) y
 * registra la corrida en `knowledge_worker_runs` (telemetría G7).
 *
 * Solo server-side (service_role; jamás exponer al cliente). Idempotente y
 * concurrency-safe. En demo/sin config: no-op. El EFECTO DE NEGOCIO del procesamiento
 * NO es de E2.1: el procesador default es no-op (los handlers reales llegan después).
 */

/** Fila de knowledge_events que recibe el procesador (subset usado). */
export interface KnowledgeEventRow {
  id: string;
  seq: number;
  event_type: string;
  entity_type: string;
  entity_id: string;
  summary: string | null;
  payload: Record<string, unknown> | null;
  source_table: string | null;
  status: string;
  retry_count: number;
  correlation_id: string | null;
}

export interface ProcessResult {
  ok: boolean;
  error?: string;
}

/** Punto de extensión del efecto de negocio. E2.1: no-op. */
export type KnowledgeEventProcessor = (ev: KnowledgeEventRow) => Promise<ProcessResult>;

export const noopProcessor: KnowledgeEventProcessor = async () => ({ ok: true });

export interface DrainOptions {
  batchSize?: number; // default 50
  maxBatches?: number; // default 20
  maxDurationMs?: number; // default 50_000
  maxRetries?: number; // default 3
  dry?: boolean;
}

export interface DrainSummary {
  status: "ok" | "partial" | "error";
  dry: boolean;
  claimed: number;
  processed: number;
  failedRetried: number;
  failedDead: number;
  retries: number;
  batches: number;
  pendingRemaining: number;
  avgEventMs: number | null;
  maxEventMs: number | null;
  durationMs: number;
  correlationId: string;
  errors: string[];
}

const DEFAULTS = { batchSize: 50, maxBatches: 20, maxDurationMs: 50_000, maxRetries: 3 };

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

function newCorrelationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`;
}

function emptySummary(dry: boolean, correlationId: string): DrainSummary {
  return {
    status: "ok",
    dry,
    claimed: 0,
    processed: 0,
    failedRetried: 0,
    failedDead: 0,
    retries: 0,
    batches: 0,
    pendingRemaining: 0,
    avgEventMs: null,
    maxEventMs: null,
    durationMs: 0,
    correlationId,
    errors: [],
  };
}

export async function drainKnowledge(
  opts: DrainOptions = {},
  processor: KnowledgeEventProcessor = noopProcessor,
): Promise<DrainSummary> {
  const cfg = { ...DEFAULTS, ...opts };
  const dry = opts.dry ?? false;
  const correlationId = newCorrelationId();
  const startedAt = new Date();
  const startMs = Date.now();

  if (isMock()) return emptySummary(dry, correlationId);
  const supabase = createAdminClient();
  if (!supabase) return emptySummary(dry, correlationId);

  const summary = emptySummary(dry, correlationId);
  const durations: number[] = [];

  async function countDue(): Promise<number> {
    const { count, error } = await supabase!
      .from("knowledge_events")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "failed"])
      .lte("available_at", new Date().toISOString());
    if (error) summary.errors.push(`count_due: ${error.message}`);
    return count ?? 0;
  }

  try {
    // Dry-run: solo cuenta los eventos due, sin reclamar ni procesar.
    if (dry) {
      summary.pendingRemaining = await countDue();
      if (summary.errors.length > 0) summary.status = "error";
      summary.durationMs = Date.now() - startMs;
      return summary;
    }

    // Recuperar atascados (lease vencido) antes de drenar.
    const { error: recErr } = await supabase.rpc("knowledge_recover_stuck");
    if (recErr) summary.errors.push(`recover_stuck: ${recErr.message}`);

    // Bucle de drenado: claim → process → mark.
    for (let b = 0; b < cfg.maxBatches; b++) {
      if (Date.now() - startMs > cfg.maxDurationMs) break;

      const { data: claimed, error: claimErr } = await supabase.rpc("knowledge_claim_batch", {
        p_limit: cfg.batchSize,
      });
      if (claimErr) {
        summary.status = "error";
        summary.errors.push(`claim: ${claimErr.message}`);
        break;
      }

      const rows = (claimed ?? []) as KnowledgeEventRow[];
      if (rows.length === 0) break;

      summary.batches++;
      summary.claimed += rows.length;

      for (const ev of rows) {
        const t0 = Date.now();
        let result: ProcessResult;
        try {
          result = await processor(ev);
        } catch (e) {
          result = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        durations.push(Date.now() - t0);

        if (result.ok) {
          const { error } = await supabase.rpc("knowledge_mark_processed", { p_id: ev.id });
          if (error) summary.errors.push(`mark_processed ${ev.id}: ${error.message}`);
          else summary.processed++;
        } else {
          const { data: newStatus, error } = await supabase.rpc("knowledge_mark_failed", {
            p_id: ev.id,
            p_error: result.error ?? "unknown",
            p_max_retries: cfg.maxRetries,
          });
          if (error) {
            summary.errors.push(`mark_failed ${ev.id}: ${error.message}`);
          } else {
            summary.retries++;
            if (newStatus === "dead") summary.failedDead++;
            else summary.failedRetried++;
          }
        }
      }
    }

    summary.pendingRemaining = await countDue();
  } catch (e) {
    summary.status = "error";
    summary.errors.push(e instanceof Error ? e.message : String(e));
  }

  summary.durationMs = Date.now() - startMs;
  summary.avgEventMs = durations.length
    ? durations.reduce((a, c) => a + c, 0) / durations.length
    : null;
  summary.maxEventMs = durations.length ? Math.max(...durations) : null;
  if (summary.status === "ok" && summary.errors.length > 0) summary.status = "partial";

  // Telemetría de la corrida (G7) — best-effort: no romper la corrida si falla.
  try {
    await supabase.rpc("knowledge_record_worker_run", {
      p_started_at: startedAt.toISOString(),
      p_duration_ms: summary.durationMs,
      p_dry: dry,
      p_claimed: summary.claimed,
      p_processed: summary.processed,
      p_failed_retried: summary.failedRetried,
      p_failed_dead: summary.failedDead,
      p_retries: summary.retries,
      p_batches: summary.batches,
      p_avg_event_ms: summary.avgEventMs,
      p_max_event_ms: summary.maxEventMs,
      p_correlation_id: correlationId,
    });
  } catch {
    // best-effort
  }

  return summary;
}
