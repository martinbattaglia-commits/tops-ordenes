import { describe, it, expect } from "vitest";
import { runSync, type SheetSource, type CashBoxDb, type SnapshotInput, type SyncLogFinal } from "./sync-engine";
import type { Cell, CellMatrix, CategoryRule, ParsedRow, SyncTrigger } from "./types";
import type { PrevRow } from "./guards";

// ---------- fixtures de matriz (solapa) ----------
const c = (value: unknown, text?: string): Cell => ({ value, text: text ?? (value == null ? "" : String(value)) });
const E: Cell = { value: null, text: "" };
const D = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));
const R9 = (cells: Record<number, Cell>): Cell[] => Array.from({ length: 9 }, (_, i) => cells[i] ?? E);
type Item = { concepto: string; importe: number };
const items = (n: number, base = 1000): Item[] => Array.from({ length: n }, (_, i) => ({ concepto: `mov ${i}`, importe: base + i }));

function sheet(o: { acred?: Item[]; gastos?: Item[]; saldo?: boolean; periodo?: number }): CellMatrix {
  const acred = o.acred ?? [], gastos = o.gastos ?? [], periodo = o.periodo ?? 2026;
  const sumA = acred.reduce((s, x) => s + x.importe, 0), sumG = gastos.reduce((s, x) => s + x.importe, 0);
  const m: CellMatrix = [];
  m.push(R9({ 0: c(`${periodo} Caja Chica`) }));
  m.push(R9({ 0: c("ACREDITADOS"), 3: c("GASTOS"), 8: o.saldo === false ? E : c("SALDO") }));
  m.push(R9({
    0: c("FECHA"), 1: c("ORIGEN"), 2: c("IMPORTE"), 3: c("FECHA"), 4: c("DESTINO"), 5: c("IMPORTE"),
    8: o.saldo === false ? E : c({ formula: "C-F", result: sumA - sumG }, "saldo"),
  }));
  const n = Math.max(acred.length, gastos.length);
  for (let i = 0; i < n; i++) {
    const a = acred[i], g = gastos[i], row: Record<number, Cell> = {};
    if (a) { row[0] = c(D(periodo, 1, (i % 28) + 1)); row[1] = c(a.concepto); row[2] = c(a.importe); }
    if (g) { row[3] = c(D(periodo, 1, (i % 28) + 1)); row[4] = c(g.concepto); row[5] = c(g.importe); }
    m.push(R9(row));
  }
  return m;
}

// ---------- mocks de dependencias ----------
class FakeSource implements SheetSource {
  loaded = false;
  constructor(private matrices: Record<number, CellMatrix | null>, private loadError?: Error) {}
  async load() { if (this.loadError) throw this.loadError; this.loaded = true; }
  getMatrix(p: number): CellMatrix | null { return this.matrices[p] ?? null; }
}

class FakeDb implements CashBoxDb {
  calls = {
    insertSyncLog: 0,
    replacePeriodo: [] as { periodo: number; rows: ParsedRow[]; runId: string | null }[],
    upsertSnapshot: [] as SnapshotInput[],
    updateSyncLog: [] as { runId: string; patch: SyncLogFinal }[],
  };
  constructor(private opts: { rules?: CategoryRule[]; counts?: Record<number, number>; prev?: Record<number, PrevRow[]> } = {}) {}
  async getCategoryRules() { return this.opts.rules ?? []; }
  async countTransactions(p: number) { return this.opts.counts?.[p] ?? 0; }
  async getPrevRows(p: number) { return this.opts.prev?.[p] ?? []; }
  async insertSyncLog(_row: { trigger: SyncTrigger; file_id: string | null; periodos: number[] }) { this.calls.insertSyncLog++; return "run-1"; }
  async replacePeriodo(periodo: number, rows: ParsedRow[], runId: string | null) { this.calls.replacePeriodo.push({ periodo, rows, runId }); return rows.length; }
  async upsertSnapshot(snap: SnapshotInput) { this.calls.upsertSnapshot.push(snap); }
  async updateSyncLog(runId: string, patch: SyncLogFinal) { this.calls.updateSyncLog.push({ runId, patch }); }
}

const now = () => new Date(Date.UTC(2026, 5, 23, 12, 0, 0)); // 2026-06-23
const deps = (source: SheetSource, db: CashBoxDb, fileId: string | null, periodos: number[]) => ({ source, db, now, fileId, periodos });

describe("runSync — happy path", () => {
  it("completed: replace + snapshot + log, saldo por etiqueta reconcilia", async () => {
    const db = new FakeDb({ counts: { 2026: 0 } });
    const src = new FakeSource({ 2026: sheet({ acred: items(3, 1000), gastos: items(2, 10) }) });
    const rep = await runSync(deps(src, db, "F", [2026]), { trigger: "cron" });

    expect(rep.status).toBe("completed");
    expect(rep.perPeriodo[0].rowsParsed).toBe(5);
    expect(db.calls.insertSyncLog).toBe(1);
    expect(db.calls.replacePeriodo).toHaveLength(1);
    expect(db.calls.replacePeriodo[0].periodo).toBe(2026);
    expect(db.calls.replacePeriodo[0].rows).toHaveLength(5); // set COMPLETO (no acumula)
    expect(db.calls.upsertSnapshot).toHaveLength(1);
    expect(db.calls.upsertSnapshot[0].snapshot_date).toBe("2026-06-23"); // 1 por día por ejercicio
    expect(db.calls.updateSyncLog).toHaveLength(1);
    expect(db.calls.updateSyncLog[0].patch.status).toBe("completed");
    // saldo: Σacred(3003) − Σgastos(21) = 2982; etiqueta = misma fórmula → delta 0
    expect(rep.perPeriodo[0].saldoSource).toBe("label");
    expect(rep.perPeriodo[0].saldoExcel).toBe(2982);
    expect(rep.perPeriodo[0].saldoDelta).toBe(0);
    expect(rep.perPeriodo[0].rowsInserted).toBe(5); // diff vs prev vacío
  });
});

describe("runSync — dryRun (sin escrituras)", () => {
  it("no escribe nada pero devuelve métricas/diff/saldo", async () => {
    const db = new FakeDb({ counts: { 2026: 0 } });
    const src = new FakeSource({ 2026: sheet({ acred: items(3, 1000), gastos: items(2, 10) }) });
    const rep = await runSync(deps(src, db, "F", [2026]), { trigger: "manual", dryRun: true });

    expect(rep.dryRun).toBe(true);
    expect(rep.status).toBe("completed");
    expect(db.calls.insertSyncLog).toBe(0);
    expect(db.calls.replacePeriodo).toHaveLength(0);
    expect(db.calls.upsertSnapshot).toHaveLength(0);
    expect(db.calls.updateSyncLog).toHaveLength(0);
    // métricas presentes
    expect(rep.rowsParsed).toBe(5);
    expect(rep.perPeriodo[0].rowsInserted).toBe(5);
    expect(rep.perPeriodo[0].saldoExcel).toBe(2982);
  });
});

describe("runSync — guardas (no borra el dataset previo)", () => {
  it("0 filas → partial, sin replace, registra error + warning", async () => {
    const db = new FakeDb({ counts: { 2026: 100 } }); // hay 100 filas previas
    const src = new FakeSource({ 2026: sheet({ acred: [], gastos: [] }) });
    const rep = await runSync(deps(src, db, "F", [2026]), { trigger: "cron" });

    expect(rep.perPeriodo[0].status).toBe("partial");
    expect(rep.perPeriodo[0].guard).toContain("0 filas");
    expect(db.calls.replacePeriodo).toHaveLength(0); // NO borró las 100 previas
    expect(db.calls.upsertSnapshot).toHaveLength(0);
    expect(rep.errors).toBeGreaterThan(0);
    expect(rep.warnings).toBeGreaterThan(0);
    expect(db.calls.updateSyncLog).toHaveLength(1); // sí cierra el log
  });

  it("caída >40% → partial, sin replace", async () => {
    const db = new FakeDb({ counts: { 2026: 100 } });
    const src = new FakeSource({ 2026: sheet({ acred: items(5), gastos: items(5) }) }); // 10 filas
    const rep = await runSync(deps(src, db, "F", [2026]), { trigger: "cron" });
    expect(rep.perPeriodo[0].status).toBe("partial");
    expect(rep.perPeriodo[0].guard).toContain("caída");
    expect(db.calls.replacePeriodo).toHaveLength(0);
  });

  it("solapa ausente → partial 'solapa ausente', sin replace", async () => {
    const db = new FakeDb({ counts: { 2026: 50 } });
    const src = new FakeSource({ 2026: null });
    const rep = await runSync(deps(src, db, "F", [2026]), { trigger: "cron" });
    expect(rep.perPeriodo[0].status).toBe("partial");
    expect(rep.perPeriodo[0].guard).toBe("solapa ausente");
    expect(db.calls.replacePeriodo).toHaveLength(0);
    expect(rep.warnings).toBeGreaterThan(0);
  });
});

describe("runSync — fallback SALDO", () => {
  it("sin etiqueta SALDO → Σ, saldo_source calc_fallback, warnings++, no aborta", async () => {
    const db = new FakeDb({ counts: { 2026: 0 } });
    const src = new FakeSource({ 2026: sheet({ acred: items(3, 1000), gastos: items(2, 10), saldo: false }) });
    const rep = await runSync(deps(src, db, "F", [2026]), { trigger: "cron" });

    expect(rep.perPeriodo[0].status).toBe("completed");
    expect(rep.perPeriodo[0].saldoSource).toBe("calc_fallback");
    expect(rep.perPeriodo[0].saldoExcel).toBe(2982); // = saldoCalc
    expect(rep.perPeriodo[0].saldoDelta).toBe(0);
    expect(rep.warnings).toBeGreaterThanOrEqual(1);
    expect(db.calls.upsertSnapshot[0].saldo_source).toBe("calc_fallback");
  });
});

describe("runSync — aislamiento multi-ejercicio", () => {
  it("procesa 2026 y 2027; cada replace lleva SOLO las filas de su período", async () => {
    const db = new FakeDb({ counts: { 2026: 0, 2027: 0 } });
    const src = new FakeSource({
      2026: sheet({ acred: items(3), gastos: items(2), periodo: 2026 }),
      2027: sheet({ acred: items(4), gastos: items(1), periodo: 2027 }),
    });
    const rep = await runSync(deps(src, db, "F", [2026, 2027]), { trigger: "cron" });

    expect(rep.status).toBe("completed");
    expect(db.calls.replacePeriodo).toHaveLength(2);
    const byPeriodo = Object.fromEntries(db.calls.replacePeriodo.map((x) => [x.periodo, x.rows.length]));
    expect(byPeriodo[2026]).toBe(5);
    expect(byPeriodo[2027]).toBe(5);
    expect(db.calls.replacePeriodo.every((x) => x.rows.every((r) => r.periodo === x.periodo))).toBe(true);
  });

  it("si 2027 falla, 2026 igual se reemplaza (aislado) y el run es partial", async () => {
    const db = new FakeDb({ counts: { 2026: 0, 2027: 10 } });
    const src = new FakeSource({ 2026: sheet({ acred: items(3), gastos: items(2) }), 2027: null });
    const rep = await runSync(deps(src, db, "F", [2026, 2027]), { trigger: "cron" });
    expect(rep.status).toBe("partial");
    expect(db.calls.replacePeriodo.map((x) => x.periodo)).toEqual([2026]);
  });
});

describe("runSync — configuración y errores", () => {
  it("sin fileId → skipped, sin tocar la DB", async () => {
    const db = new FakeDb();
    const rep = await runSync(deps(new FakeSource({}), db, null, [2026]), { trigger: "cron" });
    expect(rep.status).toBe("skipped");
    expect(db.calls.insertSyncLog).toBe(0);
    expect(db.calls.replacePeriodo).toHaveLength(0);
  });

  it("falla la descarga → error, sin replace, log cerrado", async () => {
    const db = new FakeDb({ counts: { 2026: 0 } });
    const src = new FakeSource({ 2026: sheet({ acred: items(2), gastos: items(1) }) }, new Error("boom"));
    const rep = await runSync(deps(src, db, "F", [2026]), { trigger: "cron" });
    expect(rep.status).toBe("error");
    expect(rep.message).toContain("Descarga");
    expect(db.calls.replacePeriodo).toHaveLength(0);
    expect(db.calls.insertSyncLog).toBe(1);
    expect(db.calls.updateSyncLog).toHaveLength(1);
    expect(db.calls.updateSyncLog[0].patch.status).toBe("error");
  });
});
