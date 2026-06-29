import { describe, it, expect } from "vitest";
import { evaluarMiPyME, evaluarMiPyMEParaEmision } from "./decision";

/**
 * Decisión MiPyME (req. 3 Contadora): corresponde FCE si la validación está
 * activa, el emisor es MiPyME, el cliente está en el Registro MiPyME y el
 * importe supera el mínimo. El guard bloquea emitir común cuando corresponde FCE.
 */
const base = {
  activo: true,
  emisorEsMiPyme: true,
  clienteEsMiPyme: true,
  montoTotal: 1_000_000,
  montoMinimo: 500_000,
};

describe("evaluarMiPyME", () => {
  it("corresponde FCE cuando todo se cumple y el monto supera el mínimo", () => {
    const d = evaluarMiPyME(base);
    expect(d.corresponde).toBe(true);
    expect(d.comprobanteSugerido).toBe("FCE_MIPYME");
  });

  it("NO corresponde si la validación está desactivada (seguro por defecto)", () => {
    expect(evaluarMiPyME({ ...base, activo: false }).corresponde).toBe(false);
  });

  it("NO corresponde si el emisor no es MiPyME", () => {
    expect(evaluarMiPyME({ ...base, emisorEsMiPyme: false }).corresponde).toBe(false);
  });

  it("NO corresponde si el cliente no está en el Registro MiPyME", () => {
    expect(evaluarMiPyME({ ...base, clienteEsMiPyme: false }).corresponde).toBe(false);
  });

  it("NO corresponde si el importe no supera el mínimo", () => {
    expect(evaluarMiPyME({ ...base, montoTotal: 100_000 }).corresponde).toBe(false);
  });

  it("corresponde cuando el importe iguala el mínimo (>=)", () => {
    expect(evaluarMiPyME({ ...base, montoTotal: 500_000 }).corresponde).toBe(true);
  });
});

describe("evaluarMiPyMEParaEmision (guard)", () => {
  it("bloquea emitir comprobante común cuando corresponde FCE", () => {
    const g = evaluarMiPyMEParaEmision({ ...base, esComprobanteFCE: false });
    expect(g.bloquear).toBe(true);
    expect(g.motivo).toMatch(/MiPyME|FCE|Crédito Electrónica/i);
  });

  it("NO bloquea si el comprobante solicitado ya es FCE", () => {
    const g = evaluarMiPyMEParaEmision({ ...base, esComprobanteFCE: true });
    expect(g.bloquear).toBe(false);
  });

  it("NO bloquea cuando no corresponde FCE (validación off)", () => {
    const g = evaluarMiPyMEParaEmision({ ...base, activo: false, esComprobanteFCE: false });
    expect(g.bloquear).toBe(false);
  });
});
