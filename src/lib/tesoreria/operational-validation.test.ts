import { describe, it, expect } from "vitest";
import { RegisterOperationalMovementSchema } from "./validation";

const A = "11111111-1111-4111-8111-111111111111";

const base = {
  date: "2026-07-17",
  category: "gasto_operativo",
  direction: "egreso",
  bank_account_id: A,
  amount: "1500.50",
  concept: "Nafta camioneta",
};

describe("RegisterOperationalMovementSchema", () => {
  it("acepta un movimiento operativo de una sola cuenta", () => {
    expect(RegisterOperationalMovementSchema.safeParse(base).success).toBe(true);
  });

  it("acepta la categoría 'regularizacion' con dirección explícita", () => {
    expect(RegisterOperationalMovementSchema.safeParse({ ...base, category: "regularizacion", direction: "ingreso" }).success).toBe(true);
  });

  it("exige concepto no vacío", () => {
    expect(RegisterOperationalMovementSchema.safeParse({ ...base, concept: "   " }).success).toBe(false);
  });

  it("rechaza importe con más de 2 decimales", () => {
    expect(RegisterOperationalMovementSchema.safeParse({ ...base, amount: "10.999" }).success).toBe(false);
  });

  it("rechaza dirección inválida", () => {
    expect(RegisterOperationalMovementSchema.safeParse({ ...base, direction: "lateral" }).success).toBe(false);
  });

  it("rechaza la categoría retirada 'transferencia_extraordinaria'", () => {
    expect(RegisterOperationalMovementSchema.safeParse({ ...base, category: "transferencia_extraordinaria" }).success).toBe(false);
  });

  it("rechaza la categoría retirada 'ajuste_tesoreria'", () => {
    expect(RegisterOperationalMovementSchema.safeParse({ ...base, category: "ajuste_tesoreria" }).success).toBe(false);
  });

  it("rechaza categoría desconocida", () => {
    expect(RegisterOperationalMovementSchema.safeParse({ ...base, category: "propina" }).success).toBe(false);
  });
});
