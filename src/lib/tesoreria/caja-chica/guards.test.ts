import { describe, it, expect } from "vitest";
import { evaluateGuards, computeDiff, type PrevRow } from "./guards";
import type { ParsedSheet, ParsedRow, CashBoxDirection } from "./types";

const NR = (direction: CashBoxDirection, source_row: number, row_hash: string): ParsedRow => ({
  periodo: 2026, direction, tx_date: null, tx_date_raw: "", concepto: "", importe: 0, categoria: null, source_row, row_hash,
});

const sheet = (n: number, corrupt = 0): ParsedSheet => ({
  periodo: 2026,
  rows: Array.from({ length: n }, (_, i) => NR("gasto", i + 4, "h" + i)),
  totalAcreditado: 0, totalGasto: 0, saldoCalc: 0, saldoExcel: null, saldoResuelto: 0, saldoSource: "calc_fallback",
  corruptCount: corrupt,
});

describe("evaluateGuards", () => {
  it("0 filas → bloquea", () => expect(evaluateGuards(sheet(0), 100).ok).toBe(false));
  it("primera corrida (current 0) con filas → ok", () => expect(evaluateGuards(sheet(80), 0).ok).toBe(true));
  it("caída >40% → bloquea", () => {
    const g = evaluateGuards(sheet(50), 100);
    expect(g.ok).toBe(false);
    expect(g.reason).toContain("caída");
  });
  it("caída ≤40% → ok", () => expect(evaluateGuards(sheet(70), 100).ok).toBe(true));
  it(">5% corruptos → bloquea", () => {
    const g = evaluateGuards(sheet(100, 6), 100);
    expect(g.ok).toBe(false);
    expect(g.reason).toContain("corruptos");
  });
  it("≤5% corruptos → ok", () => expect(evaluateGuards(sheet(100, 5), 100).ok).toBe(true));
  it("umbrales configurables (maxDropPct 0.2)", () => expect(evaluateGuards(sheet(70), 100, { maxDropPct: 0.2 }).ok).toBe(false));
});

const P = (direction: CashBoxDirection, source_row: number, row_hash: string): PrevRow => ({ direction, source_row, row_hash });

describe("computeDiff (posición direction+source_row)", () => {
  it("primera vez: todo inserted", () => {
    expect(computeDiff([], [NR("gasto", 4, "a"), NR("gasto", 5, "b")])).toEqual({ inserted: 2, changed: 0, removed: 0 });
  });
  it("misma posición, hash distinto → changed", () => {
    const prev = [P("gasto", 4, "a"), P("gasto", 5, "b")];
    const next = [NR("gasto", 4, "a"), NR("gasto", 5, "B!")];
    expect(computeDiff(prev, next)).toEqual({ inserted: 0, changed: 1, removed: 0 });
  });
  it("posición que desaparece → removed", () => {
    const prev = [P("gasto", 4, "a"), P("gasto", 5, "b"), P("acreditado", 4, "c")];
    expect(computeDiff(prev, [NR("gasto", 4, "a")])).toEqual({ inserted: 0, changed: 0, removed: 2 });
  });
  it("acreditado y gasto en misma source_row no colisionan", () => {
    const prev = [P("acreditado", 4, "a")];
    const next = [NR("acreditado", 4, "a"), NR("gasto", 4, "x")];
    expect(computeDiff(prev, next)).toEqual({ inserted: 1, changed: 0, removed: 0 });
  });
});
