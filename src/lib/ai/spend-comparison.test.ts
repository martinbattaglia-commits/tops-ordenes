// Slice B (aceptación 2026-07-07) · Comparador de gasto de proveedores.
// TDD RED: define el contrato del módulo ANTES de implementarlo. Dos modos,
// ambos sobre fuentes EXISTENTES (ai_supplier_spend_overview, sin migración):
//   - gasto_vs_compromiso: facturas de proveedor vs OC firmadas, lado a lado.
//   - periodo_anterior: gasto mes en curso vs último mes cerrado (variación).
// Nada se inventa: si falta un lado de la comparación, la fila lo declara.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  // Demo mode (patrón engine.test): fixtures, sin red ni DB.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("AI_PROVIDER", "mock");
  vi.stubEnv("AI_ENABLED", "1");
});

afterEach(() => vi.unstubAllEnvs());

async function compose(args: Record<string, unknown>) {
  const mod = await import("./spend-comparison");
  return mod.composeSpendComparisonRows(args);
}

describe("composeSpendComparisonRows · gasto_vs_compromiso", () => {
  it("una fila por proveedor con gasto, compromiso y diferencia calculados", async () => {
    const rows: Row[] = await compose({ mode: "gasto_vs_compromiso" });
    const comps = rows.filter((r) => r.kind === "comparacion");
    expect(comps.length).toBeGreaterThan(0);
    for (const r of comps) {
      expect(String(r.proveedor)).toBeTruthy();
      expect(typeof r.gasto).toBe("number");
      expect(typeof r.compromiso).toBe("number");
      // diferencia = compromiso − gasto (lo pendiente de ejecutar/facturar).
      expect(r.diferencia).toBe(Number(r.compromiso) - Number(r.gasto));
      expect(String(r.detalle)).toContain("gasto");
      expect(String(r.detalle)).toContain("compromiso");
    }
  });

  it("un proveedor presente en UNA sola base igual aparece (con 0 en la otra, declarado)", async () => {
    const rows: Row[] = await compose({ mode: "gasto_vs_compromiso" });
    // En fixtures hay proveedores con compromiso sin gasto equivalente:
    // la comparación no los esconde.
    const soloUnLado = rows.filter(
      (r) => r.kind === "comparacion" && (Number(r.gasto) === 0 || Number(r.compromiso) === 0)
    );
    expect(soloUnLado.length).toBeGreaterThan(0);
  });
});

describe("composeSpendComparisonRows · periodo_anterior (variación m/m)", () => {
  it("calcula variación absoluta y % por proveedor entre mes en curso y último mes", async () => {
    const rows: Row[] = await compose({ mode: "periodo_anterior" });
    const comps = rows.filter((r) => r.kind === "comparacion");
    expect(comps.length).toBeGreaterThan(0);
    for (const r of comps) {
      expect(typeof r.actual).toBe("number");
      expect(typeof r.anterior).toBe("number");
      expect(r.variacion).toBe(Number(r.actual) - Number(r.anterior));
    }
    // Ordenado por variación descendente (top subas primero).
    const vars = comps.map((r) => Number(r.variacion));
    expect(vars).toEqual([...vars].sort((a, b) => b - a));
  });

  it("proveedor NUEVO en el período (sin gasto anterior) queda marcado, no inventado", async () => {
    const rows: Row[] = await compose({ mode: "periodo_anterior" });
    const nuevos = rows.filter((r) => r.kind === "comparacion" && r.estado === "nuevo");
    expect(nuevos.length).toBeGreaterThan(0);
    for (const n of nuevos) expect(Number(n.anterior)).toBe(0);
  });
});
