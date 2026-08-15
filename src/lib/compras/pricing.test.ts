import { describe, expect, it } from "vitest";
import { computePurchasePricing, PurchasePricingError } from "./pricing";

describe("computePurchasePricing", () => {
  it("expone un total contable sólo cuando todos los precios son conocidos", () => {
    const result = computePurchasePricing([
      { qty: 2, price: 100, price_state: "known" },
      { qty: 1, price: 50, price_state: "known" },
    ]);
    expect(result.state).toBe("known");
    expect(result.accounting).toEqual({ neto: 250, iva: 52.5, total: 302.5 });
    expect(result.planning).toEqual(result.accounting);
  });

  it("separa el estimado de las métricas reales y conserva motivo", () => {
    const result = computePurchasePricing([
      { qty: 2, price: 100, price_state: "known" },
      { qty: 3, price: 20, price_state: "estimated", price_reason: "Cotización verbal" },
    ]);
    expect(result.state).toBe("estimated");
    expect(result.accounting).toBeNull();
    expect(result.planning).toEqual({ neto: 260, iva: 54.6, total: 314.6 });
    expect(result.known_partial_neto).toBe(200);
    expect(result.lines[1].price_reason).toBe("Cotización verbal");
  });

  it("representa pendiente como null y nunca como cero", () => {
    const result = computePurchasePricing([
      { qty: 4, price: null, price_state: "pending", price_reason: "Proveedor sin lista" },
    ]);
    expect(result.state).toBe("pending");
    expect(result.lines[0]).toMatchObject({ price: null, subtotal: null });
    expect(result.accounting).toBeNull();
    expect(result.planning).toBeNull();
  });

  it("rechaza un importe encubierto en una línea pendiente", () => {
    expect(() => computePurchasePricing([
      { qty: 1, price: 0, price_state: "pending", price_reason: "A confirmar" },
    ])).toThrowError(PurchasePricingError);
  });

  it("exige motivo tanto para estimado como para pendiente", () => {
    expect(() => computePurchasePricing([
      { qty: 1, price: 10, price_state: "estimated", price_reason: "" },
    ])).toThrow("requiere un motivo");
    expect(() => computePurchasePricing([
      { qty: 1, price: null, price_state: "pending", price_reason: "" },
    ])).toThrow("requiere un motivo");
  });
});
