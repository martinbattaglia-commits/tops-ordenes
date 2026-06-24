import { describe, it, expect } from "vitest";
import { categorize, matchCategoria, normalizeText, FALLBACK_CATEGORIA } from "./categorize";
import type { CategoryRule } from "./types";

const R = (
  pattern: string,
  categoria: string,
  prioridad: number,
  match_type: CategoryRule["match_type"] = "contains",
  activo = true,
): CategoryRule => ({ pattern, categoria, prioridad, match_type, activo });

// Subconjunto representativo del seed de la migración 0082.
const SEED: CategoryRule[] = [
  R("nafta", "Combustible", 10), R("peaje", "Peajes", 10),
  R("recolector de residuos", "Servicios", 20), R("cerrajeria", "Mantenimiento", 20),
  R("almuerzo", "Comida", 30), R("coca cola", "Comida", 30), R("cafe", "Comida", 30),
  R("supermercado", "Insumos", 40),
  R("anticipo", "Anticipos", 50), R("a rendir", "Anticipos", 50),
  R("venta de", "Cambio USD", 60),
  R("pago de prestamo", "Préstamos", 70), R("pago de ruth", "Préstamos", 70),
  R("divanlito", "Proveedores", 75), R("quartier", "Proveedores", 75),
  R("diferencia", "Diferencias", 80),
];

describe("normalizeText", () => {
  it("baja mayúsculas, quita tildes, colapsa espacios", () =>
    expect(normalizeText("  Cerrajería   PALERMO ")).toBe("cerrajeria palermo"));
  it("folding de ñ → n (solo para matcheo interno)", () => expect(normalizeText("Año Mañana")).toBe("ano manana"));
});

describe("match_type", () => {
  it("contains, case-insensitive", () => {
    expect(categorize("Nafta para Qubo", SEED)).toBe("Combustible");
    expect(categorize("NAFTA", SEED)).toBe("Combustible");
  });
  it("exact: matchea solo el texto exacto (normalizado)", () => {
    const rules = [R("tacuru", "Varios", 5, "exact")];
    expect(categorize("Tacuru", rules)).toBe("Varios");
    expect(categorize("Tacuru SA", rules)).toBe(FALLBACK_CATEGORIA);
  });
  it("regex", () => {
    const rules = [R("^pago de ruth", "Préstamos", 5, "regex")];
    expect(categorize("Pago de Ruth 800 de 1400", rules)).toBe("Préstamos");
    expect(categorize("Otra cosa pago de ruth", rules)).toBe(FALLBACK_CATEGORIA); // ancla ^
  });
});

describe("prioridad", () => {
  it("gana la regla de menor número de prioridad", () => {
    // contiene "anticipo" (50) y "nafta" (10) → debe ganar Combustible
    expect(categorize("Anticipo para cargar nafta", SEED)).toBe("Combustible");
  });
});

describe("normalización (objetivo 5)", () => {
  it("tildes: 'Cerrajería' matchea regla 'cerrajeria'", () => expect(categorize("Cerrajería del barrio", SEED)).toBe("Mantenimiento"));
  it("tildes: 'Café' matchea regla 'cafe'", () => expect(categorize("Café con leche", SEED)).toBe("Comida"));
  it("espacios múltiples: '  Coca   Cola '", () => expect(categorize("  Coca   Cola ", SEED)).toBe("Comida"));
  it("mayúsculas: 'SUPERMERCADO'", () => expect(categorize("SUPERMERCADO DIA", SEED)).toBe("Insumos"));
});

describe("fallback y reglas inválidas/inactivas", () => {
  it("sin match → 'Otros'", () => expect(categorize("Concepto totalmente desconocido", SEED)).toBe(FALLBACK_CATEGORIA));
  it("matchCategoria sin match → null (la vista/engine aplica 'Otros')", () =>
    expect(matchCategoria("xyz", SEED)).toBeNull());
  it("regla inactiva se ignora aunque tenga prioridad alta", () => {
    const rules = [R("nafta", "NoDebeGanar", 1, "contains", false), ...SEED];
    expect(categorize("Nafta para Qubo", rules)).toBe("Combustible");
  });
  it("regex inválida no rompe (se ignora)", () => {
    const rules = [R("[", "Bad", 1, "regex"), R("nafta", "Combustible", 10)];
    expect(() => categorize("Nafta", rules)).not.toThrow();
    expect(categorize("Nafta", rules)).toBe("Combustible");
  });
  it("concepto vacío → 'Otros'", () => expect(categorize("   ", SEED)).toBe(FALLBACK_CATEGORIA));
});

describe("conceptos reales de la planilla", () => {
  const casos: Array<[string, string]> = [
    ["Recolector de residuos ", "Servicios"],
    ["Nafta para Qubo", "Combustible"],
    ["Almuerzos de Martin", "Comida"],
    ["Anticipo Jorge Guadalupe ", "Anticipos"],
    ["Manu a Rendir ", "Anticipos"],
    ["Pago de Divanlito ", "Proveedores"],
    ["Venta de 9800 USD", "Cambio USD"],
    ["Pago de Diferencias ", "Diferencias"],
    ["Quartier ", "Proveedores"],
    ["Pago de Ruth 800 de 1400", "Préstamos"],
    ["Coca Cola ", "Comida"],
    ["Repuesto de Manifold ", FALLBACK_CATEGORIA], // sin regla en este subconjunto → Otros
  ];
  for (const [concepto, esperado] of casos) {
    it(`'${concepto.trim()}' → ${esperado}`, () => expect(categorize(concepto, SEED)).toBe(esperado));
  }
});
