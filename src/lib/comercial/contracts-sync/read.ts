/**
 * read.ts — Lectura del estado de sincronización para el tablero.
 *
 * Devuelve la última corrida, alertas de sync recientes, calidad documental y
 * la próxima corrida programada (diaria 21:00 ART). Degrada con gracia: si las
 * tablas 0077 aún no existen o no hay base, devuelve un resumen vacío.
 */

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { ContractsSyncSummary, SyncRunStatus, SyncTrigger } from "./types";

/** Próxima corrida = próximo 00:00 UTC (= 21:00 America/Argentina, UTC-3 fijo). */
export function computeNextRunAt(from: Date = new Date()): string {
  const next = new Date(from);
  next.setUTCHours(0, 0, 0, 0);
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function emptyQuality() {
  return { ok: 0, parcial: 0, sin_texto: 0, error: 0, pendiente: 0 };
}

export async function getContractsSyncSummary(): Promise<ContractsSyncSummary> {
  const driveConfigured = env.google.configured;
  const dbConfigured = env.supabase.configured && Boolean(env.supabase.serviceRoleKey);
  const empty: ContractsSyncSummary = {
    driveConfigured,
    dbConfigured,
    lastRun: null,
    nextRunAt: computeNextRunAt(),
    alerts: [],
    quality: emptyQuality(),
    totalDocs: 0,
  };

  const sb = createClient();
  if (!sb) return empty;

  try {
    const [{ data: runs }, { data: alertRows }, { data: docs }] = await Promise.all([
      sb
        .from("contract_sync_runs")
        .select(
          "run_id, trigger, status, started_at, finished_at, duration_ms, docs_seen, docs_new, docs_updated, docs_removed, contracts_upserted, alerts_raised, errors, message",
        )
        .order("started_at", { ascending: false })
        .limit(1),
      sb
        .from("contract_sync_events")
        .select("level, action, titulo, detail, created_at")
        .in("level", ["warn", "error"])
        .order("created_at", { ascending: false })
        .limit(20),
      sb.from("contract_documents").select("quality"),
    ]);

    const r = (runs ?? [])[0] as
      | {
          run_id: string;
          trigger: SyncTrigger;
          status: SyncRunStatus;
          started_at: string;
          finished_at: string | null;
          duration_ms: number | null;
          docs_seen: number;
          docs_new: number;
          docs_updated: number;
          docs_removed: number;
          contracts_upserted: number;
          alerts_raised: number;
          errors: number;
          message: string | null;
        }
      | undefined;

    const lastRun = r
      ? {
          runId: r.run_id,
          trigger: r.trigger,
          status: r.status,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          durationMs: r.duration_ms,
          docsSeen: r.docs_seen,
          docsNew: r.docs_new,
          docsUpdated: r.docs_updated,
          docsRemoved: r.docs_removed,
          contractsUpserted: r.contracts_upserted,
          alertsRaised: r.alerts_raised,
          errors: r.errors,
          message: r.message,
        }
      : null;

    const alerts = ((alertRows ?? []) as {
      level: "warn" | "error";
      action: string;
      titulo: string | null;
      detail: string | null;
      created_at: string;
    }[]).map((a) => ({ level: a.level, action: a.action, titulo: a.titulo, detail: a.detail, at: a.created_at }));

    const quality = emptyQuality();
    for (const d of (docs ?? []) as { quality: string | null }[]) {
      const k = (d.quality ?? "pendiente") as keyof typeof quality;
      if (k in quality) quality[k] += 1;
      else quality.pendiente += 1;
    }

    return {
      driveConfigured,
      dbConfigured,
      lastRun,
      nextRunAt: computeNextRunAt(),
      alerts,
      quality,
      totalDocs: (docs ?? []).length,
    };
  } catch {
    // Tablas 0077 ausentes o sin permisos → resumen vacío (módulo sigue operativo).
    return empty;
  }
}
