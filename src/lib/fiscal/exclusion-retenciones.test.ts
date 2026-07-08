import { describe, it, expect } from "vitest";
import {
  evaluarExclusionRetencion,
  certificadoVigente,
} from "./exclusion-retenciones";

/**
 * Servicio único de exclusión de retenciones (reqs 5 y 6 Contadora).
 * Centraliza la decisión hoy dispersa en el motor de Ganancias y el panel.
 */
describe("evaluarExclusionRetencion", () => {
  it("excluye al proveedor exento (precedencia máxima)", () => {
    const r = evaluarExclusionRetencion({
      tipoComprobante: "FACTURA_A",
      concepto: "honorarios",
      exentoProveedor: true,
    });
    expect(r.excluido).toBe(true);
    expect(r.categoria).toBe("exento_proveedor");
    expect(r.confianza).toBe("validar");
  });

  it("excluye Factura C (monotributista) — req. 5", () => {
    const r = evaluarExclusionRetencion({ tipoComprobante: "FACTURA_C", concepto: "servicios" });
    expect(r.excluido).toBe(true);
    expect(r.categoria).toBe("factura_C");
  });

  it("excluye comprobantes que no son Factura A (no alcanzado)", () => {
    const r = evaluarExclusionRetencion({ tipoComprobante: "FACTURA_B", concepto: "servicios" });
    expect(r.excluido).toBe(true);
    expect(r.categoria).toBe("factura_no_A");
  });

  it("excluye conceptos exentos/no alcanzados — req. 6", () => {
    for (const concepto of ["luz", "gas", "telefonia", "internet", "seguros", "excluido"]) {
      const r = evaluarExclusionRetencion({ tipoComprobante: "FACTURA_A", concepto });
      expect(r.excluido, concepto).toBe(true);
      expect(r.categoria, concepto).toBe("concepto_excluido");
    }
  });

  it("NO excluye Factura A con concepto gravado", () => {
    const r = evaluarExclusionRetencion({ tipoComprobante: "FACTURA_A", concepto: "honorarios" });
    expect(r.excluido).toBe(false);
    expect(r.categoria).toBeNull();
  });

  it("respeta precedencia: exento gana sobre Factura A gravada", () => {
    const r = evaluarExclusionRetencion({
      tipoComprobante: "FACTURA_A",
      concepto: "honorarios",
      exentoProveedor: true,
    });
    expect(r.categoria).toBe("exento_proveedor");
  });

  it("precedencia: Factura C gana sobre concepto gravado", () => {
    const r = evaluarExclusionRetencion({ tipoComprobante: "FACTURA_C", concepto: "honorarios" });
    expect(r.categoria).toBe("factura_C");
  });
});

describe("certificadoVigente", () => {
  it("vigente cuando la fecha de referencia es anterior o igual al vencimiento", () => {
    expect(certificadoVigente("2026-12-31", "2026-06-28")).toBe(true);
    expect(certificadoVigente("2026-06-28", "2026-06-28")).toBe(true);
  });
  it("no vigente cuando venció", () => {
    expect(certificadoVigente("2026-05-01", "2026-06-28")).toBe(false);
  });
  it("no vigente cuando no hay certificado", () => {
    expect(certificadoVigente(null, "2026-06-28")).toBe(false);
    expect(certificadoVigente("", "2026-06-28")).toBe(false);
  });
});
