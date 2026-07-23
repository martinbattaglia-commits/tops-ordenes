import { describe, it, expect } from "vitest";
import { RegisterOperationalMovementSchema } from "./validation";
import {
  OPERATIONAL_CATEGORY_VALUES,
  OPERATIONAL_CATEGORY_LABELS,
  OPERATIONAL_CATEGORY_DIRECTION,
  OPERATIONAL_CATEGORY_REQUIRES_BENEFICIARY,
} from "./types";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

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

// ── T-004 · categorías nuevas y beneficiario ───────────────────────────────
describe("T-004 · categorías Honorarios y Adelanto de sueldo", () => {
  it("acepta 'honorarios' con beneficiario existente", () => {
    const r = RegisterOperationalMovementSchema.safeParse({
      ...base, category: "honorarios", concept: "Honorarios contadora julio", beneficiary_id: B,
    });
    expect(r.success).toBe(true);
  });

  it("acepta 'adelanto_sueldo' con alta implícita de beneficiario", () => {
    const r = RegisterOperationalMovementSchema.safeParse({
      ...base, category: "adelanto_sueldo", concept: "Adelanto julio",
      beneficiary_name: "Juan Pérez", beneficiary_kind: "empleado", beneficiary_document: "20-12345678-9",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza mandar beneficiario existente Y nuevo a la vez", () => {
    const r = RegisterOperationalMovementSchema.safeParse({
      ...base, category: "honorarios", beneficiary_id: B, beneficiary_name: "Otro Distinto",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza un tipo de beneficiario desconocido", () => {
    const r = RegisterOperationalMovementSchema.safeParse({
      ...base, beneficiary_name: "Alguien", beneficiary_kind: "socio",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza beneficiary_id que no sea UUID", () => {
    expect(RegisterOperationalMovementSchema.safeParse({ ...base, beneficiary_id: "juan" }).success).toBe(false);
  });

  it("el beneficiario es opcional en las categorías que no son de persona", () => {
    expect(RegisterOperationalMovementSchema.safeParse({ ...base, category: "gasto_operativo" }).success).toBe(true);
  });
});

// Estos tests blindan el ESPEJO entre TS y la base. Si alguien agrega un valor
// al enum en una migración y olvida el label / la dirección / la regla de
// beneficiario, la suite lo detecta antes del deploy.
describe("T-004 · coherencia de los mapas de categoría", () => {
  it("toda categoría tiene etiqueta legible", () => {
    for (const c of OPERATIONAL_CATEGORY_VALUES) {
      expect(OPERATIONAL_CATEGORY_LABELS[c], `falta label de ${c}`).toBeTruthy();
    }
  });

  it("toda categoría declara dirección sugerida (o null explícito)", () => {
    for (const c of OPERATIONAL_CATEGORY_VALUES) {
      expect(OPERATIONAL_CATEGORY_DIRECTION, `falta dirección de ${c}`).toHaveProperty(c);
    }
  });

  it("toda categoría declara si exige beneficiario", () => {
    for (const c of OPERATIONAL_CATEGORY_VALUES) {
      expect(typeof OPERATIONAL_CATEGORY_REQUIRES_BENEFICIARY[c], `falta regla de ${c}`).toBe("boolean");
    }
  });

  it("las 5 categorías de persona exigen beneficiario — espeja el CHECK de 0194", () => {
    // Debe coincidir EXACTAMENTE con treasury_movements_beneficiary_required_ck.
    const exigen = OPERATIONAL_CATEGORY_VALUES.filter((c) => OPERATIONAL_CATEGORY_REQUIRES_BENEFICIARY[c]);
    expect([...exigen].sort()).toEqual(
      ["adelanto_director", "adelanto_efectivo", "adelanto_sueldo", "honorarios", "reintegro"].sort()
    );
  });
});
