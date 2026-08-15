import type { PurchaseOrder } from "@/lib/types-po";

export type PurchaseOrderAmountInput = Pick<
  PurchaseOrder,
  "price_state" | "total" | "planning_total" | "price_reconciled_at"
>;

export type PurchaseOrderAmount =
  | { kind: "real"; amount: number; label: "Precio conocido" | "Precio real conciliado" }
  | { kind: "estimated"; amount: number; label: "Precio estimado · no contable" }
  | { kind: "pending"; amount: null; label: "Precio pendiente · sin importe real" };

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Clasifica el importe sin usar `total ?? 0` ni convertir una estimación en
 * realidad. Un total de una OC estimada/pendiente sólo se vuelve real cuando
 * existe la marca atómica de conciliación contra factura.
 */
export function purchaseOrderAmount(order: PurchaseOrderAmountInput): PurchaseOrderAmount {
  if (order.price_reconciled_at && finite(order.total)) {
    return { kind: "real", amount: order.total, label: "Precio real conciliado" };
  }
  if (order.price_state === "known" && finite(order.total)) {
    return { kind: "real", amount: order.total, label: "Precio conocido" };
  }
  if (order.price_state === "estimated" && finite(order.planning_total)) {
    return {
      kind: "estimated",
      amount: order.planning_total,
      label: "Precio estimado · no contable",
    };
  }
  return { kind: "pending", amount: null, label: "Precio pendiente · sin importe real" };
}

export function realPurchaseAmount(order: PurchaseOrderAmountInput): number | null {
  const amount = purchaseOrderAmount(order);
  return amount.kind === "real" ? amount.amount : null;
}

export function summarizePurchaseAmounts(orders: readonly PurchaseOrderAmountInput[]): {
  realTotal: number;
  realOrders: number;
  nonRealOrders: number;
} {
  let realTotal = 0;
  let realOrders = 0;
  let nonRealOrders = 0;

  for (const order of orders) {
    const amount = realPurchaseAmount(order);
    if (amount === null) {
      nonRealOrders += 1;
    } else {
      realTotal += amount;
      realOrders += 1;
    }
  }

  return { realTotal, realOrders, nonRealOrders };
}
