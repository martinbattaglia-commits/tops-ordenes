import { describe, expect, it, vi } from "vitest";
import type { PurchaseOrder } from "@/lib/types-po";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: { app: { demoMode: false, needsSupabase: false } },
}));

import { computeKpis } from "./data";

function order(
  date: string,
  priceState: PurchaseOrder["price_state"],
  total: number | null,
  overrides: Partial<PurchaseOrder> = {},
): PurchaseOrder {
  return {
    id: `${date}-${priceState}`,
    public_id: `OC-${date}`,
    date,
    status: "firmada",
    price_state: priceState,
    total,
    planning_total: priceState === "estimated" ? 500 : null,
    price_reconciled_at: null,
    categoria: "Insumos",
    signed_at: date,
    ...overrides,
  } as PurchaseOrder;
}

describe("KPIs canónicos de compras", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");

  it("suma sólo importes reales del mes y conserva pendientes como no reales", () => {
    const kpi = computeKpis([
      order("2026-08-10T12:00:00.000Z", "known", 121),
      order("2026-08-11T12:00:00.000Z", "estimated", null),
      order("2026-08-12T12:00:00.000Z", "pending", null),
      order("2026-07-12T12:00:00.000Z", "known", 999),
    ], now);

    expect(kpi.ocThisMonth).toBe(3);
    expect(kpi.spendThisMonth).toBe(121);
    expect(kpi.nonRealThisMonth).toBe(2);
    expect(kpi.categoryMix).toEqual([
      expect.objectContaining({ label: "Insumos", amount: 121, pct: 100 }),
    ]);
  });

  it("no mezcla el mismo mes de otros años en el período actual ni en la serie", () => {
    const kpi = computeKpis([
      order("2026-08-10T12:00:00.000Z", "known", 121),
      order("2025-08-10T12:00:00.000Z", "known", 9999),
    ], now);

    expect(kpi.ocThisMonth).toBe(1);
    expect(kpi.spendThisMonth).toBe(121);
    expect(kpi.serie6m.emitidas.at(-1)).toBe(121);
  });
});
