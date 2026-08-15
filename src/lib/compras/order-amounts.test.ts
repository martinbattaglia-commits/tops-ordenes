import { describe, expect, it } from "vitest";
import { purchaseOrderAmount, summarizePurchaseAmounts } from "./order-amounts";

describe("importes canónicos de órdenes de compra", () => {
  it("no convierte pendientes en cero ni confía en un total huérfano", () => {
    expect(purchaseOrderAmount({
      price_state: "pending",
      total: 999,
      planning_total: null,
      price_reconciled_at: null,
    })).toEqual({
      kind: "pending",
      amount: null,
      label: "Precio pendiente · sin importe real",
    });
  });

  it("separa estimación de importe real", () => {
    expect(purchaseOrderAmount({
      price_state: "estimated",
      total: null,
      planning_total: 1210,
      price_reconciled_at: null,
    })).toEqual({
      kind: "estimated",
      amount: 1210,
      label: "Precio estimado · no contable",
    });
  });

  it("reconoce como real un pendiente sólo después de conciliar", () => {
    expect(purchaseOrderAmount({
      price_state: "pending",
      total: 363,
      planning_total: null,
      price_reconciled_at: "2026-08-15T03:00:00.000Z",
    })).toEqual({
      kind: "real",
      amount: 363,
      label: "Precio real conciliado",
    });
  });

  it("las métricas suman únicamente importes reales y reportan exclusiones", () => {
    expect(summarizePurchaseAmounts([
      { price_state: "known", total: 121, planning_total: 121, price_reconciled_at: null },
      { price_state: "estimated", total: null, planning_total: 242, price_reconciled_at: null },
      { price_state: "pending", total: null, planning_total: null, price_reconciled_at: null },
      { price_state: "pending", total: 363, planning_total: null, price_reconciled_at: "2026-08-15" },
    ])).toEqual({ realTotal: 484, realOrders: 2, nonRealOrders: 2 });
  });
});
