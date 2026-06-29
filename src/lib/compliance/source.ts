/**
 * source.ts — Carga server-side del Compliance Cockpit (Supabase → fallback).
 *
 * El cockpit (/anmat) deja de depender directamente del snapshot hardcodeado:
 *   1. Intenta leer `compliance_items` desde Supabase (RLS, usuario autenticado).
 *   2. Si Supabase no está configurado, la tabla está vacía o falla → cae al
 *      snapshot de src/lib/compliance/data.ts (ITEMS) y lo marca en logs.
 *   3. Lee la última corrida de `compliance_sync_log` para el indicador de estado.
 *
 * Sólo lectura. El recálculo de vencimientos (deriveItems) lo sigue haciendo la
 * página sobre los items devueltos — no cambia.
 */

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { ITEMS, deriveComplianceStatus, type ComplianceItem } from "./data";
import { rowToItem, COMPLIANCE_ITEM_COLUMNS, type ComplianceRow } from "./row";
import type { ComplianceCaseLite } from "./cases/types";

async function loadActiveCases(
  db: ReturnType<typeof createClient>,
): Promise<Map<string, ComplianceCaseLite>> {
  const map = new Map<string, ComplianceCaseLite>();
  if (!db) return map;
  try {
    const { data, error } = await db
      .from("compliance_cases")
      .select("item_id,estado_administrativo,etapa,nivel_riesgo,origen,confianza,activo")
      .eq("activo", true);
    if (error || !data) return map; // tabla inexistente (migración no aplicada) → sin casos
    for (const r of data as Array<Record<string, string | null>>) {
      if (!r.item_id) continue;
      map.set(r.item_id, {
        estadoAdministrativo: (r.estado_administrativo ?? "sin_iniciar") as ComplianceCaseLite["estadoAdministrativo"],
        etapa: (r.etapa ?? null) as ComplianceCaseLite["etapa"],
        nivelRiesgo: (r.nivel_riesgo ?? null) as ComplianceCaseLite["nivelRiesgo"],
        origen: (r.origen ?? "sheet") as ComplianceCaseLite["origen"],
        confianza: (r.confianza ?? "confirmada") as ComplianceCaseLite["confianza"],
      });
    }
  } catch { /* sin casos */ }
  return map;
}

export type CockpitOrigin = "supabase" | "fallback";

export interface CockpitSource {
  items: ComplianceItem[];
  origin: CockpitOrigin;
  /** Motivo del fallback (null si origin = supabase). */
  reason: string | null;
}

export type SyncState = "synced" | "errors" | "fallback" | "never";

export interface LastSyncRun {
  runId: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  documentsScanned: number;
  documentsUpserted: number;
  documentsRemoved: number;
  itemsTouched: number;
  alertsCreated: number;
  errors: number;
  message: string | null;
}

export interface SyncStatus {
  state: SyncState;
  lastRun: LastSyncRun | null;
  /** Próxima corrida programada (ISO) — diaria 21:00 ART (00:00 UTC). */
  nextRunAt: string | null;
  driveConfigured: boolean;
  dbConfigured: boolean;
}

function logFallback(reason: string): void {
  console.warn(
    JSON.stringify({ ts: new Date().toISOString(), level: "warn", mod: "compliance", op: "load.fallback", reason }),
  );
}

/** Próxima ejecución del cron diario 00:00 UTC, como ISO. */
function nextCronUtc(now: Date = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

/** Carga los ítems del cockpit: Supabase si hay datos, snapshot como fallback. */
export async function loadComplianceItems(): Promise<CockpitSource> {
  if (!env.supabase.configured) {
    logFallback("supabase-not-configured");
    return { items: ITEMS, origin: "fallback", reason: "Supabase no configurado" };
  }
  const db = createClient();
  if (!db) {
    logFallback("supabase-client-null");
    return { items: ITEMS, origin: "fallback", reason: "Cliente Supabase no disponible" };
  }
  try {
    const { data, error } = await db.from("compliance_items").select(COMPLIANCE_ITEM_COLUMNS);
    if (error) {
      logFallback(`query-error: ${error.message}`);
      return { items: ITEMS, origin: "fallback", reason: `Error de consulta: ${error.message}` };
    }
    const rows = (data ?? []) as ComplianceRow[];
    if (rows.length === 0) {
      logFallback("table-empty");
      return { items: ITEMS, origin: "fallback", reason: "Tabla compliance_items vacía" };
    }
    const cases = await loadActiveCases(db);
    const items = rows.map((r) => {
      const it = rowToItem(r);
      const c = cases.get(it.id);
      return c ? { ...it, activeCase: c } : it;
    });
    return { items, origin: "supabase", reason: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    logFallback(`exception: ${reason}`);
    return { items: ITEMS, origin: "fallback", reason };
  }
}

/** Lee la última corrida de sincronización (para el indicador de estado). */
export async function loadSyncStatus(origin: CockpitOrigin): Promise<SyncStatus> {
  const driveConfigured = env.google.configured;
  const dbConfigured = env.supabase.configured;
  const base: SyncStatus = {
    state: "never",
    lastRun: null,
    nextRunAt: nextCronUtc(),
    driveConfigured,
    dbConfigured,
  };

  if (origin === "fallback") return { ...base, state: "fallback" };

  const db = createClient();
  if (!db) return { ...base, state: "fallback" };

  try {
    const { data, error } = await db
      .from("compliance_sync_log")
      .select(
        "run_id,trigger,status,started_at,finished_at,duration_ms,documents_scanned,documents_upserted,documents_removed,items_touched,alerts_created,errors,message",
      )
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      // Tabla inexistente (migración no aplicada) o sin corridas → nunca sincronizado.
      return base;
    }

    const row = data as {
      run_id: string; trigger: string; status: string; started_at: string;
      finished_at: string | null; duration_ms: number | null;
      documents_scanned: number; documents_upserted: number; documents_removed: number;
      items_touched: number; alerts_created: number; errors: number; message: string | null;
    };

    const lastRun: LastSyncRun = {
      runId: row.run_id,
      trigger: row.trigger,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      documentsScanned: row.documents_scanned,
      documentsUpserted: row.documents_upserted,
      documentsRemoved: row.documents_removed,
      itemsTouched: row.items_touched,
      alertsCreated: row.alerts_created,
      errors: row.errors,
      message: row.message,
    };
    const state: SyncState = row.status === "error" || row.errors > 0 ? "errors" : "synced";
    return { ...base, state, lastRun };
  } catch {
    return base;
  }
}

/** Carga combinada para la página: items (con origen) + estado de sync. */
export async function loadComplianceCockpit(): Promise<{ source: CockpitSource; sync: SyncStatus }> {
  const source = await loadComplianceItems();
  const sync = await loadSyncStatus(source.origin);
  return { source, sync };
}

/**
 * Carga un ítem por id (ficha /anmat/[id]): Supabase con fallback al snapshot.
 * Devuelve el ítem YA derivado a la fecha actual. `undefined` si no existe.
 */
export async function loadComplianceItem(id: string): Promise<ComplianceItem | undefined> {
  const fallback = () => {
    const base = ITEMS.find((i) => i.id === id);
    return base ? deriveComplianceStatus(base) : undefined;
  };
  if (!env.supabase.configured) return fallback();
  const db = createClient();
  if (!db) return fallback();
  try {
    const { data, error } = await db
      .from("compliance_items")
      .select(COMPLIANCE_ITEM_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return fallback();
    const cases = await loadActiveCases(db);
    const it = rowToItem(data as ComplianceRow);
    const c = cases.get(it.id);
    return deriveComplianceStatus(c ? { ...it, activeCase: c } : it);
  } catch {
    return fallback();
  }
}
