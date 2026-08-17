/**
 * R-3 · Un importe ausente no es cero.
 *
 * El contrato de FASE B prohíbe mostrar "$ 0" (o "$ 1") para una línea con
 * precio pendiente. `fmtCurrency` no puede sostenerlo: recibe ceros legítimos
 * —bonificaciones al 100 %, ítems sin cargo, KPIs en cero— y debe seguir
 * imprimiéndolos como "$ 0". La distinción entre "no cotizado" (null) y
 * "cotizado en cero" se decide acá, antes de formatear.
 */
import { describe, expect, it } from "vitest";
import { fmtCurrency } from "@/lib/utils";
import { PENDING_MONEY_LABEL, fmtMoneyOrPending } from "@/lib/pricing/money-display";

describe("fmtMoneyOrPending · el pendiente nunca se imprime como importe", () => {
  it("null se muestra como pendiente, no como $ 0", () => {
    expect(fmtMoneyOrPending(null, "ARS")).toBe(PENDING_MONEY_LABEL);
    expect(fmtMoneyOrPending(null, "ARS")).not.toContain("0");
  });

  it("undefined se comporta igual que null", () => {
    expect(fmtMoneyOrPending(undefined, "ARS")).toBe(PENDING_MONEY_LABEL);
  });

  it("un cero legítimo SIGUE siendo $ 0 — no se lo confunde con pendiente", () => {
    expect(fmtMoneyOrPending(0, "ARS")).toBe(fmtCurrency(0, "ARS"));
    expect(fmtMoneyOrPending(0, "ARS")).not.toBe(PENDING_MONEY_LABEL);
  });

  it("un importe real se formatea exactamente como fmtCurrency", () => {
    expect(fmtMoneyOrPending(1234, "ARS")).toBe(fmtCurrency(1234, "ARS"));
    expect(fmtMoneyOrPending(1234, "USD")).toBe(fmtCurrency(1234, "USD"));
  });

  it("la ausencia de importe gana sobre la de moneda: primero es pendiente", () => {
    expect(fmtMoneyOrPending(null, null)).toBe(PENDING_MONEY_LABEL);
  });

  it("con importe presente y moneda ausente se preserva la señal de integridad", () => {
    expect(fmtMoneyOrPending(1234, null)).toBe("— · MONEDA NO INFORMADA");
  });

  it("admite una etiqueta propia para superficies compactas", () => {
    expect(fmtMoneyOrPending(null, "ARS", "Pendiente")).toBe("Pendiente");
  });

  // R-3.c · un valor no finito no es un importe. Delegarlo a fmtCurrency
  // reimprimía justamente el síntoma que este formateador viene a erradicar:
  // NaN salía como "$ 0" e Infinity como "$ ∞".
  it("NaN no se imprime como $ 0", () => {
    expect(fmtMoneyOrPending(NaN, "ARS")).toBe(PENDING_MONEY_LABEL);
    expect(fmtMoneyOrPending(NaN, "ARS")).not.toContain("0");
  });

  it("Infinity y -Infinity tampoco se imprimen como importe", () => {
    expect(fmtMoneyOrPending(Infinity, "ARS")).toBe(PENDING_MONEY_LABEL);
    expect(fmtMoneyOrPending(-Infinity, "ARS")).toBe(PENDING_MONEY_LABEL);
    expect(fmtMoneyOrPending(Infinity, "ARS")).not.toContain("∞");
  });

  it("regresión: fmtCurrency conserva su contrato para null (no se lo altera)", () => {
    // Se documenta a propósito. El arreglo NO cambia fmtCurrency, porque sus
    // call-sites legítimos dependen de que un cero se vea como cero.
    expect(fmtCurrency(null)).toBe("$ 0");
    expect(fmtCurrency(0)).toBe("$ 0");
  });
});
