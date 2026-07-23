import { describe, it, expect } from "vitest";
import {
  filterCajaMovimientos,
  monthlyIngresoEgreso,
  ingresoEgresoSplit,
  resumenCaja,
} from "./native-logic";
import type { CajaMovRow } from "./native-data";

const mov = (o: Partial<CajaMovRow>): CajaMovRow => ({
  movement_id: o.movement_id ?? "m1",
  public_id: o.public_id ?? "MOV-2026-000001",
  date: o.date ?? "2026-07-10",
  direction: o.direction ?? "egreso",
  amount: o.amount ?? 100,
  concepto: o.concepto ?? "c",
  status: o.status ?? "confirmado",
  voided_at: o.voided_at ?? null,
  void_reason: o.void_reason ?? null,
  created_at: o.created_at ?? "2026-07-10T12:00:00Z",
  responsable_id: o.responsable_id ?? "r1",
  responsable: o.responsable ?? "R. Núñez",
  observaciones: o.observaciones ?? null,
});

describe("filterCajaMovimientos", () => {
  const data = [
    mov({ movement_id: "1", direction: "ingreso", date: "2026-01-15" }),
    mov({ movement_id: "2", direction: "egreso", date: "2026-02-10" }),
    mov({ movement_id: "3", direction: "egreso", date: "2026-03-20" }),
  ];
  it("sin filtros → todo", () => expect(filterCajaMovimientos(data, {})).toHaveLength(3));
  it("por tipo", () =>
    expect(filterCajaMovimientos(data, { tipo: "egreso" }).map((r) => r.movement_id)).toEqual(["2", "3"]));
  it("por rango de fecha", () =>
    expect(
      filterCajaMovimientos(data, { desde: "2026-02-01", hasta: "2026-02-28" }).map((r) => r.movement_id),
    ).toEqual(["2"]));
  it("tipo inválido se ignora", () => expect(filterCajaMovimientos(data, { tipo: "raro" })).toHaveLength(3));
});

describe("monthlyIngresoEgreso", () => {
  it("separa ingresos y egresos por mes e ignora anulados", () => {
    const r = monthlyIngresoEgreso([
      mov({ direction: "ingreso", date: "2026-01-10", amount: 100 }),
      mov({ direction: "egreso", date: "2026-01-20", amount: 40 }),
      mov({ direction: "egreso", date: "2026-01-25", amount: 60, status: "anulado" }),
      mov({ direction: "egreso", date: "2026-03-05", amount: 25 }),
    ]);
    expect(r[0]).toMatchObject({ mes: 1, ingreso: 100, egreso: 40 });
    expect(r[2]).toMatchObject({ mes: 3, ingreso: 0, egreso: 25 });
    expect(r).toHaveLength(12);
  });
});

describe("ingresoEgresoSplit", () => {
  it("calcula totales y porcentajes sobre no anulados", () => {
    const s = ingresoEgresoSplit([
      mov({ direction: "ingreso", amount: 25 }),
      mov({ direction: "egreso", amount: 75 }),
      mov({ direction: "egreso", amount: 999, status: "anulado" }),
    ]);
    expect(s).toMatchObject({ ingresos: 25, egresos: 75, pctIngresos: 25, pctEgresos: 75, movimientos: 2 });
  });
  it("sin movimientos → 0% sin dividir por cero", () => {
    expect(ingresoEgresoSplit([])).toMatchObject({ ingresos: 0, egresos: 0, pctIngresos: 0, pctEgresos: 0 });
  });
});

describe("resumenCaja", () => {
  it("Saldo ERP viene de la vista; sin pendientes la Diferencia es 0", () => {
    const r = resumenCaja([mov({ amount: 100 }), mov({ movement_id: "2", amount: 50 })], 1000);
    expect(r).toMatchObject({ saldoErp: 1000, saldoActual: 1000, diferencia: 0, cantidad: 2 });
  });
  it("los pendientes explican la Diferencia (con signo)", () => {
    const r = resumenCaja(
      [mov({ amount: 100, status: "confirmado" }), mov({ movement_id: "2", amount: 30, direction: "egreso", status: "pendiente" })],
      1000,
    );
    expect(r.diferencia).toBe(-30);
    expect(r.saldoActual).toBe(970);
  });
  it("los anulados no cuentan en la cantidad", () => {
    const r = resumenCaja([mov({ status: "anulado" }), mov({ movement_id: "2" })], 0);
    expect(r.cantidad).toBe(1);
  });
  it("última operación = created_at máximo (incluye anulados: se registraron)", () => {
    const r = resumenCaja(
      [
        mov({ created_at: "2026-07-01T10:00:00Z" }),
        mov({ movement_id: "2", created_at: "2026-07-22T16:48:00Z" }),
      ],
      0,
    );
    expect(r.ultimaOperacion).toBe("2026-07-22T16:48:00Z");
  });
  it("sin saldo del motor → KPIs de saldo en null (no inventa números)", () => {
    const r = resumenCaja([mov({})], null);
    expect(r.saldoErp).toBeNull();
    expect(r.saldoActual).toBeNull();
    expect(r.diferencia).toBeNull();
  });
});
