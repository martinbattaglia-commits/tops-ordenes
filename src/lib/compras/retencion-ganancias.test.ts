import { describe, it, expect } from "vitest";
import {
  calculateIncomeTaxRetention,
  DEFAULT_CONFIG,
  DEFAULT_ESCALA,
  type RetenciónParams,
} from "./retencion-ganancias";

/**
 * Tests de CARACTERIZACIÓN del motor de Ganancias (v1.0, prod).
 * Fijan el comportamiento de las reglas de exclusión ANTES de refactorizar
 * a `src/lib/fiscal/exclusion-retenciones.ts`. Tras el refactor deben seguir
 * en verde (comportamiento preservado, incl. textos de auditoría).
 */
function params(over: Partial<RetenciónParams>): RetenciónParams {
  return {
    tipoComprobante: "FACTURA_A",
    concepto: "honorarios",
    netoGravado: 0,
    acumuladoPrevio: 0,
    totalFactura: 0,
    exentoProveedor: false,
    config: DEFAULT_CONFIG,
    escala: DEFAULT_ESCALA,
    normativaVersion: "2026-01-01",
    ...over,
  };
}

describe("calculateIncomeTaxRetention — exclusiones (caracterización)", () => {
  it("R1: proveedor exento → no corresponde, método excluido, confianza validar", () => {
    const r = calculateIncomeTaxRetention(params({ netoGravado: 500_000, exentoProveedor: true }));
    expect(r.corresponde).toBe(false);
    expect(r.metodo).toBe("excluido");
    expect(r.retencion).toBe(0);
    expect(r.confianza).toBe("validar");
    expect(r.resumenEjecutivo).toContain("exento");
  });

  it("R2: Factura C → no corresponde (Monotributista) — req. 5", () => {
    const r = calculateIncomeTaxRetention(params({ tipoComprobante: "FACTURA_C", concepto: "servicios", netoGravado: 500_000 }));
    expect(r.corresponde).toBe(false);
    expect(r.retencion).toBe(0);
    expect(r.resumenEjecutivo).toContain("Monotributista");
  });

  it("R2: Factura B (no A) → no corresponde (operación no alcanzada)", () => {
    const r = calculateIncomeTaxRetention(params({ tipoComprobante: "FACTURA_B", concepto: "servicios", netoGravado: 500_000 }));
    expect(r.corresponde).toBe(false);
    expect(r.resumenEjecutivo).toContain("solo se practica sobre Factura A");
  });

  it("R3: concepto excluido (seguros) en Factura A → no corresponde", () => {
    const r = calculateIncomeTaxRetention(params({ concepto: "seguros", netoGravado: 500_000 }));
    expect(r.corresponde).toBe(false);
    expect(r.motivo).toBe("Concepto excluido de retención de Ganancias.");
  });

  it("Factura A + honorarios sobre el mínimo → corresponde, método escala", () => {
    const r = calculateIncomeTaxRetention(params({ concepto: "honorarios", netoGravado: 1_000_000 }));
    expect(r.corresponde).toBe(true);
    expect(r.metodo).toBe("escala");
    expect(r.retencion).toBeGreaterThan(0);
  });

  it("Factura A + servicios bajo el mínimo → no corresponde (bajo mínimo)", () => {
    const r = calculateIncomeTaxRetention(params({ concepto: "servicios", netoGravado: 1_000 }));
    expect(r.corresponde).toBe(false);
    expect(r.metodo).toBe("lineal");
    expect(r.motivo).toContain("no supera el mínimo");
  });

  it("precedencia: exento gana sobre comprobante no-A", () => {
    const r = calculateIncomeTaxRetention(params({ tipoComprobante: "FACTURA_C", exentoProveedor: true, netoGravado: 500_000 }));
    expect(r.resumenEjecutivo).toContain("exento");
  });
});
