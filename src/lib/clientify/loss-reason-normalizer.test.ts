import { describe, it, expect } from "vitest";
import { normalizeLossReason, isCanonical, CANONICAL_REASONS } from "./loss-reason-normalizer";

describe("normalizeLossReason", () => {
  it("null y string vacío → Sin clasificar", () => {
    expect(normalizeLossReason(null)).toBe("Sin clasificar");
    expect(normalizeLossReason(undefined)).toBe("Sin clasificar");
    expect(normalizeLossReason("")).toBe("Sin clasificar");
    expect(normalizeLossReason("   ")).toBe("Sin clasificar");
  });

  it("variantes de Precio", () => {
    expect(normalizeLossReason("Precio")).toBe("Precio");
    expect(normalizeLossReason("precio")).toBe("Precio");
    expect(normalizeLossReason("PRECIO")).toBe("Precio");
    expect(normalizeLossReason("Price")).toBe("Precio");
    expect(normalizeLossReason("price")).toBe("Precio");
  });

  it("variantes de Condiciones", () => {
    expect(normalizeLossReason("Condiciones")).toBe("Condiciones");
    expect(normalizeLossReason("condiciones")).toBe("Condiciones");
    expect(normalizeLossReason("No había Disponibilidad de Espacio")).toBe("Condiciones");
    expect(normalizeLossReason("Sin capacidad")).toBe("Condiciones");
    expect(normalizeLossReason("conditions")).toBe("Condiciones");
  });

  it("variantes de No contesta / N/A", () => {
    expect(normalizeLossReason("No contesta N/A")).toBe("No contesta / N/A");
    expect(normalizeLossReason("No contesta")).toBe("No contesta / N/A");
    expect(normalizeLossReason("N/A")).toBe("No contesta / N/A");
    expect(normalizeLossReason("n/a")).toBe("No contesta / N/A");
    expect(normalizeLossReason("No responde")).toBe("No contesta / N/A");
    expect(normalizeLossReason("Sin respuesta")).toBe("No contesta / N/A");
  });

  it("variantes de Otros", () => {
    expect(normalizeLossReason("Otros")).toBe("Otros");
    expect(normalizeLossReason("otros")).toBe("Otros");
    expect(normalizeLossReason("Other")).toBe("Otros");
    expect(normalizeLossReason("other")).toBe("Otros");
  });

  it("texto libre no reconocido → Otros", () => {
    expect(normalizeLossReason("Proyecto cancelado")).toBe("Otros");
    expect(normalizeLossReason("Budget freeze")).toBe("Otros");
    expect(normalizeLossReason("Competencia")).toBe("Otros");
  });

  it("idempotente para categorías canónicas reales de Clientify", () => {
    // Las categorías que Clientify devuelve como texto exacto deben round-trip correctamente.
    expect(normalizeLossReason("Precio")).toBe("Precio");
    expect(normalizeLossReason("Condiciones")).toBe("Condiciones");
    expect(normalizeLossReason("Otros")).toBe("Otros");
  });

  it("'Sin clasificar' solo se genera para null/vacío, no como input de Clientify", () => {
    // Clientify nunca envía "Sin clasificar" — esa es nuestra categoría interna para vacíos.
    expect(normalizeLossReason(null)).toBe("Sin clasificar");
    expect(normalizeLossReason("")).toBe("Sin clasificar");
  });
});

describe("isCanonical", () => {
  it("devuelve true para cada categoría canónica", () => {
    for (const r of CANONICAL_REASONS) {
      expect(isCanonical(r)).toBe(true);
    }
  });

  it("devuelve false para variantes crudas de Clientify", () => {
    expect(isCanonical("No contesta N/A")).toBe(false);
    expect(isCanonical("Price")).toBe(false);
    expect(isCanonical("Other")).toBe(false);
    expect(isCanonical(null)).toBe(false);
    expect(isCanonical(undefined)).toBe(false);
    expect(isCanonical("")).toBe(false);
  });
});
