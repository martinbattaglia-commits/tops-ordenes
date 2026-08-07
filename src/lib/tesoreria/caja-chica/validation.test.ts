import { describe, it, expect } from "vitest";
import { RegistrarCajaMovimientoSchema } from "./validation";

// CCN-002: la moneda es EXPLÍCITA y obligatoria en la app — no hay default que
// pueda registrar en una caja no elegida.

const base = {
  date: "2026-07-28",
  direction: "egreso" as const,
  amount: "150.50",
  concept: "Compra de insumos",
  responsable_id: "6b1f8f3a-0000-4000-8000-000000000001",
  observations: null,
};

describe("RegistrarCajaMovimientoSchema · currency", () => {
  it("acepta ARS", () => {
    expect(RegistrarCajaMovimientoSchema.safeParse({ ...base, currency: "ARS" }).success).toBe(true);
  });
  it("acepta USD", () => {
    expect(RegistrarCajaMovimientoSchema.safeParse({ ...base, currency: "USD" }).success).toBe(true);
  });
  it("rechaza la ausencia de moneda (sin default silencioso)", () => {
    expect(RegistrarCajaMovimientoSchema.safeParse(base).success).toBe(false);
  });
  it("rechaza monedas no habilitadas", () => {
    for (const c of ["EUR", "ars", "usd", "", null]) {
      expect(RegistrarCajaMovimientoSchema.safeParse({ ...base, currency: c }).success).toBe(false);
    }
  });
  it("la moneda no altera el resto de las validaciones (importe inválido sigue fallando)", () => {
    expect(
      RegistrarCajaMovimientoSchema.safeParse({ ...base, currency: "USD", amount: "12.345" }).success,
    ).toBe(false);
  });
});
