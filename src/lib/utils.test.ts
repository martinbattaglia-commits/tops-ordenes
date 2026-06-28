import { describe, it, expect } from "vitest";
import { fmtMoney, fmtCurrency } from "./utils";

/**
 * fmtMoney — formateo EXACTO de dinero (centavos visibles) para superficies
 * transaccionales de Tesorería. A diferencia de fmtCurrency (redondea a pesos
 * enteros, convención de PDF/dashboards), fmtMoney NUNCA oculta centavos.
 *
 * Regresión raíz: el saldo real $0,50 de FP-2026-0019 se mostraba como "$ 1"
 * porque fmtCurrency hace Math.round(0,50) = 1. El usuario imputaba $1 confiando
 * en el display y la RPC rechazaba (1,00 > 0,50). "Lo que se ve = lo que se valida".
 */
describe("fmtMoney (Tesorería · dinero exacto)", () => {
  it("muestra los centavos exactos — NO los redondea a pesos enteros", () => {
    // El corazón del bug: fmtCurrency miente, fmtMoney dice la verdad.
    expect(fmtCurrency(0.5)).toBe("$ 1"); // comportamiento defectuoso documentado
    expect(fmtMoney(0.5)).toBe("$ 0,50"); // saldo real de FP-2026-0019
  });

  it("formatea con coma decimal y punto de miles (es-AR), 2 decimales fijos", () => {
    expect(fmtMoney(1000611.5)).toBe("$ 1.000.611,50"); // total real de FP-2026-0019
    expect(fmtMoney(1)).toBe("$ 1,00");
    expect(fmtMoney(1500)).toBe("$ 1.500,00");
    expect(fmtMoney(0.01)).toBe("$ 0,01");
  });

  it("normaliza cero, nulos y NaN a '$ 0,00'", () => {
    expect(fmtMoney(0)).toBe("$ 0,00");
    expect(fmtMoney(null)).toBe("$ 0,00");
    expect(fmtMoney(undefined)).toBe("$ 0,00");
    expect(fmtMoney(NaN)).toBe("$ 0,00");
  });

  it("redondea a 2 decimales de forma estable (sin drift de punto flotante)", () => {
    // 0.1 + 0.2 = 0.30000000000000004 en IEEE-754 → debe verse "$ 0,30".
    expect(fmtMoney(0.1 + 0.2)).toBe("$ 0,30");
  });
});
