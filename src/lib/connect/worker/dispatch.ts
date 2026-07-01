import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * F4.1A — Worker de drenado de connect_outbox (espejo del worker de Knowledge, drain.ts).
 *
 * Reclama lotes de eventos `pending`/`failed` due (RPC 0160 con FOR UPDATE SKIP LOCKED + lease),
 * procesa por topic, transiciona estados (processed | failed+backoff | dead), aplica retención
 * (prune de processed > 30 días, D-F41-7) y registra la corrida en `connect_worker_runs` (EOL).
 *
 * MODELO HÍBRIDO (spec §A4/NOTIF-1, D-F41-1): los efectos de notificación acotados (menciones,
 * DM) son SÍNCRONOS vía triggers (0161) — NO pasan por acá. El worker F4.1 GOBIERNA la cola:
 * drena el backlog histórico SIN efectos (D-F41-3/8, contado en `skipped`) y deja la superficie
 * OCP donde F4.2/F4.4 enchufan digest/incidentes/egress sin tocar el pipeline.
 *
 * Solo server-side (service_role; jamás exponer al cliente). Idempotente y concurrency-safe.
 * En demo/sin config: no-op.
 */

/** Fila de connect_outbox que recibe el procesador (subset usado). */
export interface OutboxRow {
  seq: number;
  topic: string;
  payload: Record<string, unknown> | null;
  status: string;
  retry_count: number;
  created_at: string;
}

export interface ProcessResult {
  ok: boolean;
  /** true = drenado sin efecto de negocio (backlog / topic de gobierno). */
  skipped?: boolean;
  error?: string;
}

export type OutboxProcessor = (row: OutboxRow) => Promise<ProcessResult>;

/**
 * Procesador F4.1 (D-F41-3/8): TODO topic se drena sin efecto — `connect.message.posted`
 * ya tuvo su fan-out síncrono en el trigger (0161); topics desconocidos se drenan como
 * skipped (no envenenan la cola) y quedan visibles en telemetría/log.
 */
export const governanceProcessor: OutboxProcessor = async () => ({ ok: true, skipped: true });

export interface DispatchOptions {
  batchSize?: number; // default 50
  maxBatches?: number; // default 20
  maxDurationMs?: number; // default 50_000
  maxRetries?: number; // default 3
  pruneKeepDays?: number; // default 30 (D-F41-7)
  dry?: boolean;
}

export interface DispatchSummary {
  status: "ok" | "partial" | "error";
  dry: boolean;
  claimed: number;
  processed: number;
  skipped: number;
  failedRetried: number;
  failedDead: number;
  retries: number;
  batches: number;
  pruned: number;
  pendingRemaining: number;
  avgEventMs: number | null;
  maxEventMs: number | null;
  durationMs: number;
  correlationId: string;
  errors: string[];
}

const DEFAULTS = { batchSize: 50, maxBatches: 20, maxDurationMs: 50_000, maxRetries: 3, pruneKeepDays: 30 };

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

function newCorrelationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`;
}

function emptySummary(dry: boolean, correlationId: string): DispatchSummary {
  return {
    status: "ok",
    dry,
    claimed: 0,
    processed: 0,
    skipped: 0,
    failedRetried: 0,
    failedDead: 0,
    retries: 0,
    batches: 0,
    pruned: 0,
    pendingRemaining: 0,
    avgEventMs: null,
    maxEventMs: null,
    durationMs: 0,
    correlationId,
    errors: [],
  };
}

export async function dispatchConnectOutbox(
  opts: DispatchOptions = {},
  processor: OutboxProcessor = governanceProcessor,
): Promise<DispatchSummary> {
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
      .from("connect_outbox")
      .select("seq", { count: "exact", head: true })
      .in("status", ["pending", "failed"])
      .lte("available_at", new Date().toISOString());
    if (error) summary.errors.push(`count_due: ${error.message}`);
    return count ?? 0;
  }

  try {
    // Dry-run: solo cuenta los eventos due, sin reclamar ni procesar (D-F41-3: conteo antes).
    if (dry) {
      summary.pendingRemaining = await countDue();
      if (summary.errors.length > 0) summary.status = "error";
      summary.durationMs = Date.now() - startMs;
      return summary;
    }

    // Recuperar atascados (lease vencido) antes de drenar.
    const { error: recErr } = await supabase.rpc("connect_recover_stuck");
    if (recErr) summary.errors.push(`recover_stuck: ${recErr.message}`);

    // Bucle de drenado: claim → process → mark.
    for (let b = 0; b < cfg.maxBatches; b++) {
      if (Date.now() - startMs > cfg.maxDurationMs) break;

      const { data: claimed, error: claimErr } = await supabase.rpc("connect_claim_batch", {
        p_limit: cfg.batchSize,
      });
      if (claimErr) {
        summary.status = "error";
        summary.errors.push(`claim: ${claimErr.message}`);
        break;
      }

      const rows = (claimed ?? []) as OutboxRow[];
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
          const { error } = await supabase.rpc("connect_mark_processed", { p_seq: ev.seq });
          if (error) summary.errors.push(`mark_processed ${ev.seq}: ${error.message}`);
          else {
            summary.processed++;
            if (result.skipped) summary.skipped++;
          }
        } else {
          const { data: newStatus, error } = await supabase.rpc("connect_mark_failed", {
            p_seq: ev.seq,
            p_error: result.error ?? "unknown",
            p_max_retries: cfg.maxRetries,
          });
          if (error) {
            summary.errors.push(`mark_failed ${ev.seq}: ${error.message}`);
          } else {
            summary.retries++;
            if (newStatus === "dead") summary.failedDead++;
            else summary.failedRetried++;
          }
        }
      }
    }

    // Retención (D-F41-7): borra processed viejos; dead se conserva (forense).
    const { data: pruned, error: pruneErr } = await supabase.rpc("connect_prune_outbox", {
      p_keep: `${cfg.pruneKeepDays} days`,
    });
    if (pruneErr) summary.errors.push(`prune: ${pruneErr.message}`);
    else summary.pruned = Number(pruned ?? 0);

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

  // Telemetría de la corrida (EOL) — best-effort: no romper la corrida si falla.
  try {
    await supabase.rpc("connect_record_worker_run", {
      p_started_at: startedAt.toISOString(),
      p_duration_ms: summary.durationMs,
      p_dry: dry,
      p_claimed: summary.claimed,
      p_processed: summary.processed,
      p_skipped: summary.skipped,
      p_failed_retried: summary.failedRetried,
      p_failed_dead: summary.failedDead,
      p_retries: summary.retries,
      p_batches: summary.batches,
      p_pruned: summary.pruned,
      p_avg_event_ms: summary.avgEventMs,
      p_max_event_ms: summary.maxEventMs,
      p_correlation_id: correlationId,
    });
  } catch {
    // best-effort
  }

  return summary;
}
