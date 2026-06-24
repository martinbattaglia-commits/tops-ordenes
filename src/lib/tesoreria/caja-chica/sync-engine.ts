// Motor de sincronización de Caja Chica.
//
// Diseñado con INYECCIÓN DE DEPENDENCIAS: `runSync(deps, opts)` es pura
// orquestación (testeable con mocks, sin Drive ni Supabase). El wiring real
// `runCajaChicaSync(opts)` arma las dependencias contra Drive + Supabase.
//
// Pipeline por período: getMatrix → parseMatrix → categorize → guardas →
// diff → cash_box_replace_periodo (snapshot-replace atómico) → upsert snapshot
// → log. Soporta dryRun (no escribe nada, pero reporta métricas/diff/saldo).

import type {
  CajaChicaSyncReport, PeriodoResult, SyncEvent, SyncTrigger, SyncStatus,
  ParsedRow, CategoryRule, CellMatrix, SaldoSource,
} from "./types";
import { parseMatrix } from "./parse";
import { categorize } from "./categorize";
import { evaluateGuards, computeDiff, type PrevRow, type GuardOpts } from "./guards";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---- Dependencias inyectables ------------------------------------------
export interface SheetSource {
  /** Descarga/abre el workbook una vez (puede tirar error → falla global). */
  load(): Promise<void>;
  /** Matriz de la solapa del período, o null si la solapa no existe. */
  getMatrix(periodo: number): CellMatrix | null;
}

export interface SnapshotInput {
  periodo: number;
  snapshot_date: string;
  sync_run_id: string | null;
  total_acreditado: number;
  total_gasto: number;
  saldo_excel: number | null;
  saldo_calc: number;
  saldo_delta: number | null;
  saldo_source: SaldoSource;
  movimientos: number;
  por_categoria: Record<string, number>;
}

export interface SyncLogFinal {
  status: SyncStatus;
  finished_at: string;
  duration_ms: number;
  rows_parsed: number;
  rows_inserted: number;
  rows_changed: number;
  rows_removed: number;
  saldo_excel: number | null;
  saldo_calc: number | null;
  saldo_delta: number | null;
  warnings: number;
  errors: number;
  message: string;
  report: unknown;
}

export interface CashBoxDb {
  getCategoryRules(): Promise<CategoryRule[]>;
  countTransactions(periodo: number): Promise<number>;
  getPrevRows(periodo: number): Promise<PrevRow[]>;
  insertSyncLog(row: { trigger: SyncTrigger; file_id: string | null; periodos: number[] }): Promise<string | null>;
  replacePeriodo(periodo: number, rows: ParsedRow[], runId: string | null): Promise<number>;
  upsertSnapshot(snap: SnapshotInput): Promise<void>;
  updateSyncLog(runId: string, patch: SyncLogFinal): Promise<void>;
}

export interface CajaChicaDeps {
  source: SheetSource;
  db: CashBoxDb;
  now: () => Date;
  fileId: string | null;
  periodos: number[];
}

export interface RunOpts {
  trigger: SyncTrigger;
  dryRun?: boolean;
  guardOpts?: GuardOpts;
}

function aggByCategoria(rows: ParsedRow[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of rows) {
    if (r.direction !== "gasto") continue;
    const k = r.categoria ?? "Otros";
    acc[k] = round2((acc[k] ?? 0) + r.importe);
  }
  return acc;
}

export function pickPrimary(perPeriodo: PeriodoResult[]): PeriodoResult | null {
  const completed = perPeriodo.filter((p) => p.status === "completed");
  const pool = completed.length ? completed : perPeriodo;
  return pool.length ? pool.reduce((a, b) => (b.periodo > a.periodo ? b : a)) : null;
}

/** Orquestación pura. NO toca Drive/Supabase directamente: todo vía `deps`. */
export async function runSync(deps: CajaChicaDeps, opts: RunOpts): Promise<CajaChicaSyncReport> {
  const t0 = deps.now();
  const events: SyncEvent[] = [];
  const log = (level: SyncEvent["level"], msg: string, periodo?: number) => events.push({ level, msg, periodo });
  const periodos = deps.periodos.length ? Array.from(new Set(deps.periodos)) : [t0.getUTCFullYear()];

  const base: CajaChicaSyncReport = {
    runId: null, trigger: opts.trigger, status: "running", startedAt: t0.toISOString(),
    finishedAt: null, durationMs: 0, fileId: deps.fileId, periodos,
    rowsParsed: 0, rowsInserted: 0, rowsChanged: 0, rowsRemoved: 0,
    warnings: 0, errors: 0, dryRun: !!opts.dryRun, message: "", perPeriodo: [], events,
  };

  const stamp = (rep: CajaChicaSyncReport): CajaChicaSyncReport => {
    const t1 = deps.now();
    return { ...rep, finishedAt: t1.toISOString(), durationMs: t1.getTime() - t0.getTime() };
  };

  // (1) Validar configuración antes de ejecutar.
  if (!deps.fileId) {
    log("error", "CAJA_CHICA_DRIVE_FILE_ID ausente");
    return stamp({ ...base, status: "skipped", message: "Sin fileId configurado" });
  }

  // Registro de corrida (status=running). En dryRun NO se escribe nada.
  let runId: string | null = null;
  if (!opts.dryRun) {
    runId = await deps.db.insertSyncLog({ trigger: opts.trigger, file_id: deps.fileId, periodos });
  }
  base.runId = runId;

  // (2) Cargar el workbook una sola vez. Falla de descarga → error global.
  try {
    await deps.source.load();
  } catch (e) {
    log("error", `Descarga/apertura del Excel falló: ${errMsg(e)}`);
    base.errors++;
    return finalize({ ...base, status: "error", message: `Descarga falló: ${errMsg(e)}` });
  }

  const rules = await deps.db.getCategoryRules();

  for (const periodo of periodos) {
    const pr = await processPeriodo(periodo, rules);
    base.perPeriodo.push(pr);
    base.rowsParsed += pr.rowsParsed;
    base.rowsInserted += pr.rowsInserted;
    base.rowsChanged += pr.rowsChanged;
    base.rowsRemoved += pr.rowsRemoved;
    base.warnings += pr.warnings;
    if (pr.status === "error" || pr.status === "partial") base.errors++;
  }

  const anyOk = base.perPeriodo.some((p) => p.status === "completed");
  const anyBad = base.perPeriodo.some((p) => p.status !== "completed");
  const status: SyncStatus = !anyOk ? "error" : anyBad ? "partial" : "completed";
  const message = `Períodos: ${base.perPeriodo.map((p) => `${p.periodo}:${p.status}`).join(", ")}`;
  return finalize({ ...base, status, message });

  // ---- helpers internos ----
  async function processPeriodo(periodo: number, catRules: CategoryRule[]): Promise<PeriodoResult> {
    const matrix = deps.source.getMatrix(periodo);
    if (matrix == null) {
      log("error", `Solapa ${periodo} ausente — período omitido (no se borra)`, periodo);
      log("warn", `Período ${periodo}: snapshot-replace abortado (solapa ausente)`, periodo);
      return {
        periodo, status: "partial", rowsParsed: 0, rowsInserted: 0, rowsChanged: 0, rowsRemoved: 0,
        saldoExcel: null, saldoCalc: 0, saldoDelta: null, saldoSource: null, warnings: 1, guard: "solapa ausente",
      };
    }

    const parsed = parseMatrix(matrix, periodo);
    for (const r of parsed.rows) r.categoria = categorize(r.concepto, catRules);

    let warnings = 0;
    if (parsed.saldoSource === "calc_fallback") {
      warnings++;
      log("warn", `Período ${periodo}: etiqueta SALDO no encontrada → fallback Σ`, periodo);
    }
    const saldoExcel = parsed.saldoResuelto;
    const saldoCalc = parsed.saldoCalc;
    const saldoDelta = round2(saldoExcel - saldoCalc);

    const currentCount = await deps.db.countTransactions(periodo);
    const guard = evaluateGuards(parsed, currentCount, opts.guardOpts);
    if (!guard.ok) {
      log("error", `Período ${periodo} bloqueado por guarda: ${guard.reason} (no se borra)`, periodo);
      log("warn", `Período ${periodo}: snapshot-replace abortado`, periodo);
      return {
        periodo, status: "partial", rowsParsed: parsed.rows.length, rowsInserted: 0, rowsChanged: 0, rowsRemoved: 0,
        saldoExcel, saldoCalc, saldoDelta, saldoSource: parsed.saldoSource, warnings: warnings + 1, guard: guard.reason,
      };
    }

    const prev = await deps.db.getPrevRows(periodo);
    const diff = computeDiff(prev, parsed.rows);

    if (!opts.dryRun) {
      await deps.db.replacePeriodo(periodo, parsed.rows, runId);
      await deps.db.upsertSnapshot({
        periodo, snapshot_date: dateOnly(deps.now()), sync_run_id: runId,
        total_acreditado: parsed.totalAcreditado, total_gasto: parsed.totalGasto,
        saldo_excel: saldoExcel, saldo_calc: saldoCalc, saldo_delta: saldoDelta,
        saldo_source: parsed.saldoSource, movimientos: parsed.rows.length,
        por_categoria: aggByCategoria(parsed.rows),
      });
    }

    return {
      periodo, status: "completed", rowsParsed: parsed.rows.length,
      rowsInserted: diff.inserted, rowsChanged: diff.changed, rowsRemoved: diff.removed,
      saldoExcel, saldoCalc, saldoDelta, saldoSource: parsed.saldoSource, warnings,
    };
  }

  async function finalize(rep: CajaChicaSyncReport): Promise<CajaChicaSyncReport> {
    const out = stamp(rep);
    if (opts.dryRun || !runId) return out;
    const primary = pickPrimary(out.perPeriodo);
    await deps.db.updateSyncLog(runId, {
      status: out.status, finished_at: out.finishedAt!, duration_ms: out.durationMs,
      rows_parsed: out.rowsParsed, rows_inserted: out.rowsInserted, rows_changed: out.rowsChanged, rows_removed: out.rowsRemoved,
      saldo_excel: primary?.saldoExcel ?? null, saldo_calc: primary?.saldoCalc ?? null, saldo_delta: primary?.saldoDelta ?? null,
      warnings: out.warnings, errors: out.errors, message: out.message,
      report: { perPeriodo: out.perPeriodo, events: out.events.slice(0, 200) },
    });
    return out;
  }
}

// El wiring real (runCajaChicaSync, que arma Drive + Supabase) vive en ./sync.ts,
// para mantener este módulo PURO (sin imports de Drive/Supabase/Next) y poder
// unit-testear runSync con mocks.
