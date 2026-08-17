/**
 * R-3.a · Una OS sin cotizar no factura cero: no factura todavía.
 *
 * La RPC de 0249 inserta la orden pendiente con `total` e `issued_total` en
 * NULL pero con `pricing_currency` heredada del tarifario (0249:431). Por eso
 * pasa el filtro de moneda del KPI y su ausencia de importe se sumaba como 0,
 * sin aparecer tampoco en el contador de órdenes excluidas: el tablero no
 * podía distinguir "no hubo facturación" de "hay órdenes sin cotizar".
 *
 * Es alcanzable por construcción desde el primer día de FASE B, porque toda
 * orden emitida por un encargado nace pendiente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
  env: { app: { demoMode: false, needsSupabase: false }, email: {} },
}));
vi.mock("@/lib/rbac/boot-permissions", () => ({
  getDepotManagerBoot: vi.fn(),
}));

import { buildKpisFromOrders } from "@/lib/data/orders";
import type { Order } from "@/lib/types";

const thisMonth = new Date();

function order(overrides: Partial<Order>): Order {
  return {
    id: `o-${Math.abs(Number(overrides.total ?? 0))}-${overrides.public_id ?? "x"}`,
    public_id: "OS-000001",
    depot: "MAGALDI",
    date: thisMonth.toISOString(),
    hours: 1,
    status: "FIRMADA",
    pricing_currency: "ARS",
    total: 0,
    ...overrides,
  } as Order;
}

describe("buildKpisFromOrders · las órdenes sin cotizar no entran a la facturación", () => {
  beforeEach(() => vi.clearAllMocks());

  it("una OS pendiente no aporta 0 al revenue: queda excluida y contada", () => {
    const kpis = buildKpisFromOrders([
      order({ public_id: "OS-1", total: 10_000, pricing_complete: true }),
      order({ public_id: "OS-2", total: null, issued_total: null, pricing_complete: false }),
    ]);

    expect(kpis.revenueProjection).toBe(10_000);
    // La pendiente debe declararse fuera del agregado, igual que una OS en
    // otra moneda. Si se la contara como 0 quedaría invisible.
    expect(kpis.revenueExcludedOrders).toBe(1);
  });

  it("todas pendientes: facturación 0 pero con las órdenes declaradas como excluidas", () => {
    const kpis = buildKpisFromOrders([
      order({ public_id: "OS-1", total: null, pricing_complete: false }),
      order({ public_id: "OS-2", total: null, pricing_complete: false }),
    ]);

    expect(kpis.revenueProjection).toBe(0);
    expect(kpis.revenueExcludedOrders).toBe(2);
  });

  it("sigue excluyendo por moneda, y ambas causas se acumulan", () => {
    const kpis = buildKpisFromOrders([
      order({ public_id: "OS-1", total: 5_000, pricing_complete: true }),
      order({ public_id: "OS-2", total: 900, pricing_currency: "USD", pricing_complete: true }),
      order({ public_id: "OS-3", total: null, pricing_complete: false }),
    ]);

    expect(kpis.revenueProjection).toBe(5_000);
    expect(kpis.revenueExcludedOrders).toBe(2);
  });

  it("un cero facturado legítimo SÍ cuenta como cotizado, no como excluido", () => {
    const kpis = buildKpisFromOrders([
      order({ public_id: "OS-1", total: 0, pricing_complete: true }),
    ]);

    expect(kpis.revenueProjection).toBe(0);
    expect(kpis.revenueExcludedOrders).toBe(0);
  });

  it("prefiere issued_total sobre total cuando ambos existen", () => {
    const kpis = buildKpisFromOrders([
      order({ public_id: "OS-1", total: 1_000, issued_total: 1_200, pricing_complete: true }),
    ]);

    expect(kpis.revenueProjection).toBe(1_200);
  });
});
