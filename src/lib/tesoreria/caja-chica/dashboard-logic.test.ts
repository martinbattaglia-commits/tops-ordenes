import { describe, it, expect } from "vitest";
import { monthlyGasto, categoriaDistribution, distinctCategorias, filterMovimientos, conciliacionTone } from "./dashboard-logic";
import type { MovRow, ResumenRow } from "./data";

const mov = (o: Partial<MovRow>): MovRow => ({
  id: o.id ?? "x", periodo: 2026, direction: o.direction ?? "gasto", tx_date: o.tx_date === undefined ? "2026-01-15" : o.tx_date,
  tx_date_raw: o.tx_date_raw ?? "15/01", concepto: o.concepto ?? "c", importe: o.importe ?? 100,
  categoria: o.categoria ?? "Otros", source_row: o.source_row ?? 4,
});

describe("monthlyGasto", () => {
  it("suma gastos por mes, ignora acreditados y fechas null", () => {
    const r = monthlyGasto([
      mov({ direction: "gasto", tx_date: "2026-01-10", importe: 100 }),
      mov({ direction: "gasto", tx_date: "2026-01-20", importe: 50 }),
      mov({ direction: "gasto", tx_date: "2026-03-01", importe: 30 }),
      mov({ direction: "acreditado", tx_date: "2026-01-05", importe: 9999 }),
      mov({ direction: "gasto", tx_date: null, importe: 7 }),
    ]);
    expect(r).toHaveLength(12);
    expect(r[0]).toEqual({ mes: 1, label: "Ene", total: 150 });
    expect(r[2].total).toBe(30);
    expect(r[1].total).toBe(0);
  });
});

describe("categoriaDistribution", () => {
  it("agrupa gastos por categoría con % y orden desc", () => {
    const d = categoriaDistribution([
      mov({ direction: "gasto", categoria: "Comida", importe: 75 }),
      mov({ direction: "gasto", categoria: "Comida", importe: 25 }),
      mov({ direction: "gasto", categoria: "Servicios", importe: 100 }),
      mov({ direction: "acreditado", categoria: "Cambio USD", importe: 9999 }),
    ]);
    expect(d[0]).toEqual({ categoria: "Comida", total: 100, pct: 50 });
    expect(d[1]).toEqual({ categoria: "Servicios", total: 100, pct: 50 });
    expect(d).toHaveLength(2); // acreditado excluido
  });
});

describe("distinctCategorias", () => {
  it("únicas y ordenadas", () =>
    expect(distinctCategorias([mov({ categoria: "Servicios" }), mov({ categoria: "Comida" }), mov({ categoria: "Comida" })])).toEqual(["Comida", "Servicios"]));
});

describe("filterMovimientos", () => {
  const data = [
    mov({ id: "1", categoria: "Comida", tx_date: "2026-01-10" }),
    mov({ id: "2", categoria: "Servicios", tx_date: "2026-02-15" }),
    mov({ id: "3", categoria: "Comida", tx_date: "2026-03-20" }),
  ];
  it("sin filtros → todo", () => expect(filterMovimientos(data, {})).toHaveLength(3));
  it("por categoría", () => expect(filterMovimientos(data, { categoria: "Comida" }).map((r) => r.id)).toEqual(["1", "3"]));
  it("por rango de fecha", () => expect(filterMovimientos(data, { desde: "2026-02-01", hasta: "2026-02-28" }).map((r) => r.id)).toEqual(["2"]));
  it("combinado", () => expect(filterMovimientos(data, { categoria: "Comida", desde: "2026-02-01" }).map((r) => r.id)).toEqual(["3"]));
});

describe("conciliacionTone", () => {
  const base: ResumenRow = {
    periodo: 2026, total_acreditado: 0, total_gasto: 0, movimientos: 1, saldo_calculado: 0,
    saldo_excel: 100, saldo_delta: 0, saldo_source: "label", ultimo_snapshot: "2026-06-23",
    last_run_id: "r1", last_status: "completed", last_warnings: 0, ultima_sync: "2026-06-23T00:05Z",
  };
  it("conciliado (delta 0, sin warnings, completed)", () => expect(conciliacionTone(base)).toBe("ok"));
  it("warning si hay warnings", () => expect(conciliacionTone({ ...base, last_warnings: 1 })).toBe("warn"));
  it("warning si delta ≠ 0", () => expect(conciliacionTone({ ...base, saldo_delta: 5 })).toBe("warn"));
  it("warning si saldo_source calc_fallback", () => expect(conciliacionTone({ ...base, saldo_source: "calc_fallback" })).toBe("warn"));
  it("warning si status partial", () => expect(conciliacionTone({ ...base, last_status: "partial" })).toBe("warn"));
  it("error si status error", () => expect(conciliacionTone({ ...base, last_status: "error" })).toBe("error"));
  it("sin resumen → warn", () => expect(conciliacionTone(null)).toBe("warn"));
});
