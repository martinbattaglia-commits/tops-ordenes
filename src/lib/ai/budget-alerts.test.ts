// LINK-WA-002 · E1.1 · Guarda B (PRESUPUESTO) — tests de la alerta al 70 %.
//
// Lo que se prueba: el umbral, la NO duplicación, la separación por provider y
// modelo, el costo cero del mock, y que la alerta NUNCA rompa un análisis.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { ai: { limits: { monthlyBudgetUsd: 15 } } },
}));

import { ALERT_THRESHOLD_PCT, currentPeriod, pctOf, maybeRaiseBudgetAlert, alertMessage } from "./budget-alerts";

/** Cliente Supabase mínimo: rpc del gasto + upsert de la alerta. */
function fakeClient(opts: {
  spend?: number;
  rpcError?: boolean;
  inserted?: unknown[];
  insertError?: boolean;
}) {
  const upsert = vi.fn((_row: Record<string, unknown>, _opts: Record<string, unknown>) => ({
    select: vi.fn(async () => ({
      data: opts.insertError ? null : (opts.inserted ?? [{ id: "a1" }]),
      error: opts.insertError ? { message: "relation does not exist" } : null,
    })),
  }));
  const rpc = vi.fn(async () => ({
    data: opts.spend ?? 0,
    error: opts.rpcError ? { message: "boom" } : null,
  }));
  const client = { rpc, from: vi.fn(() => ({ upsert })) };
  return { client: client as unknown as Parameters<typeof maybeRaiseBudgetAlert>[0], rpc, upsert };
}

const GEMINI = { provider: "gemini", model: "gemini-2.5-flash", userId: "u1" };

beforeEach(() => vi.clearAllMocks());

describe("B1 · el umbral es 70 % y se evalúa contra el tope real", () => {
  it("el umbral declarado es 70", () => {
    expect(ALERT_THRESHOLD_PCT).toBe(70);
  });

  it("pctOf calcula sobre el tope y no divide por cero", () => {
    expect(pctOf(10.5, 15)).toBe(70);
    expect(pctOf(15, 15)).toBe(100);
    expect(pctOf(5, 0)).toBe(0);
  });

  it("por debajo del 70 % NO alerta ni escribe", async () => {
    const { client, upsert } = fakeClient({ spend: 10 }); // 66,7 % de 15
    const o = await maybeRaiseBudgetAlert(client, GEMINI);
    expect(o.raised).toBe(false);
    expect(o.pct).toBeCloseTo(66.67, 1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("en el 70 % exacto (USD 10,50 de 15) SÍ alerta", async () => {
    const { client, upsert } = fakeClient({ spend: 10.5 });
    const o = await maybeRaiseBudgetAlert(client, GEMINI);
    expect(o.raised).toBe(true);
    expect(o.pct).toBe(70);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe("B2 · sin duplicados", () => {
  it("si la fila ya existía, no vuelve a alertar: informa alreadyRaised", async () => {
    const { client } = fakeClient({ spend: 12, inserted: [] }); // ignoreDuplicates ⇒ 0 filas
    const o = await maybeRaiseBudgetAlert(client, GEMINI);
    expect(o.raised).toBe(false);
    expect(o.alreadyRaised).toBe(true);
  });

  it("el upsert declara la clave de unicidad e ignora duplicados", async () => {
    const { client, upsert } = fakeClient({ spend: 12 });
    await maybeRaiseBudgetAlert(client, GEMINI);
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "period,threshold_pct", ignoreDuplicates: true });
  });

  it("el período es el mes en curso en formato YYYY-MM", () => {
    expect(currentPeriod(new Date("2026-07-29T23:00:00Z"))).toBe("2026-07");
    expect(currentPeriod(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01"); // cero a la izquierda
  });
});

describe("B3 · separación por provider y modelo", () => {
  it("la fila registra provider y modelo de la corrida", async () => {
    const { client, upsert } = fakeClient({ spend: 12 });
    await maybeRaiseBudgetAlert(client, GEMINI);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      period: currentPeriod(), threshold_pct: 70,
      spent_usd: 12, cap_usd: 15,
      provider: "gemini", model: "gemini-2.5-flash", raised_by: "u1",
    });
  });
});

describe("B4 · el mock tiene costo USD 0,00 ⇒ jamás alerta", () => {
  it("con provider mock no consulta el gasto ni escribe", async () => {
    const { client, rpc, upsert } = fakeClient({ spend: 99 });
    const o = await maybeRaiseBudgetAlert(client, { provider: "mock", model: "mock-1", userId: "u1" });
    expect(o.raised).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("B5 · la alerta NO puede romper el análisis (degradación silenciosa)", () => {
  it("sin cliente de datos devuelve sin alertar", async () => {
    const o = await maybeRaiseBudgetAlert(null, GEMINI);
    expect(o.raised).toBe(false);
  });

  it("si el RPC del gasto falla, no alerta y no lanza", async () => {
    const { client, upsert } = fakeClient({ spend: 14, rpcError: true });
    await expect(maybeRaiseBudgetAlert(client, GEMINI)).resolves.toMatchObject({ raised: false });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("si la tabla 0214 todavía no existe, no alerta y no lanza", async () => {
    const { client } = fakeClient({ spend: 14, insertError: true });
    await expect(maybeRaiseBudgetAlert(client, GEMINI)).resolves.toMatchObject({ raised: false });
  });
});

describe("B6 · el mensaje humano dice cifras y el bloqueo", () => {
  it("nombra porcentaje, gasto, tope y el corte al 100 %", async () => {
    const { client } = fakeClient({ spend: 10.5 });
    const m = alertMessage(await maybeRaiseBudgetAlert(client, GEMINI));
    expect(m).toContain("70.0 %");
    expect(m).toContain("10.5000");
    expect(m).toContain("15.00");
    expect(m).toContain("100 %");
  });
});
