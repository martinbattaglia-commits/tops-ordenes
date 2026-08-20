import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error stub inyectado por alias en vitest.wms-ui.config.ts
import { __setAdminClient, __setSessionClient } from "@/lib/supabase/server";
import { resolvePhysicalUnitPodShipment } from "@/lib/custody/dispatch-egress";

type Row = Record<string, unknown>;
const UNIT = "11111111-1111-4111-8111-111111111111";
const UNIT_B = "11111111-1111-4111-8111-111111111112";
const ALLOC_A = "22222222-2222-4222-8222-222222222221";
const ALLOC_B = "22222222-2222-4222-8222-222222222222";
const ORDER_A = "33333333-3333-4333-8333-333333333331";
const ORDER_B = "33333333-3333-4333-8333-333333333332";
const SHIPMENT = "44444444-4444-4444-8444-444444444444";

function pick(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value === null || value === undefined) return undefined;
    return (value as Row)[key];
  }, row);
}

function db(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const rows = tables[table] ?? [];
      const resolve = () => rows.filter((row) => filters.every((filter) => filter(row)));
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = (column: string, value: unknown) => {
        filters.push((row) => pick(row, column) === value);
        return query;
      };
      query.in = (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(pick(row, column)));
        return query;
      };
      query.neq = (column: string, value: unknown) => {
        filters.push((row) => pick(row, column) !== value);
        return query;
      };
      query.order = () => query;
      query.maybeSingle = async () => ({ data: resolve()[0] ?? null, error: null });
      query.then = (done: (value: { data: Row[]; error: null }) => unknown) =>
        done({ data: resolve(), error: null });
      return query;
    },
  };
}

function bridge() {
  return [
    { allocation_id: ALLOC_A, physical_unit_id: UNIT, quantity: 5 },
    { allocation_id: ALLOC_B, physical_unit_id: UNIT, quantity: 5 },
  ];
}

function allocations(orderB = ORDER_A, statusB = "despachada", quantityA = 5) {
  return [
    {
      id: ALLOC_A,
      quantity: quantityA,
      status: "despachada",
      logistics_order_items: { order_id: ORDER_A },
    },
    {
      id: ALLOC_B,
      quantity: 5,
      status: statusB,
      logistics_order_items: { order_id: orderB },
    },
  ];
}

beforeEach(() => {
  __setSessionClient(null);
  __setAdminClient(null);
});

describe("CPU fraccionada y atribución de POD", () => {
  it("resuelve sólo cuando la cantidad completa viajó en un único shipment", async () => {
    __setAdminClient(db({ custody_allocation_physical_units: bridge() }));
    __setSessionClient(db({
      custody_physical_units: [{ id: UNIT, quantity: 10 }],
      stock_allocations: allocations(),
      shipments: [{
        id: SHIPMENT,
        public_id: "DSP-2026-0001",
        order_id: ORDER_A,
        status: "entregado",
        delivered_at: "2026-08-20T12:00:00.000Z",
        dispatched_at: "2026-08-20T10:00:00.000Z",
      }],
    }));

    await expect(resolvePhysicalUnitPodShipment(UNIT)).resolves.toEqual({
      shipmentId: SHIPMENT,
      shipmentPublicId: "DSP-2026-0001",
      delivered: true,
    });
  });

  it("acepta una allocation cubierta exactamente por varias CPU del mismo shipment", async () => {
    __setAdminClient(db({
      custody_allocation_physical_units: [
        { allocation_id: ALLOC_A, physical_unit_id: UNIT, quantity: 5 },
        { allocation_id: ALLOC_A, physical_unit_id: UNIT_B, quantity: 5 },
      ],
    }));
    __setSessionClient(db({
      custody_physical_units: [{ id: UNIT, quantity: 5 }],
      stock_allocations: [{
        id: ALLOC_A,
        quantity: 10,
        status: "despachada",
        logistics_order_items: { order_id: ORDER_A },
      }],
      shipments: [{
        id: SHIPMENT,
        public_id: "DSP-2026-0001",
        order_id: ORDER_A,
        status: "entregado",
        delivered_at: "2026-08-20T12:00:00.000Z",
        dispatched_at: "2026-08-20T10:00:00.000Z",
      }],
    }));

    await expect(resolvePhysicalUnitPodShipment(UNIT)).resolves.toEqual({
      shipmentId: SHIPMENT,
      shipmentPublicId: "DSP-2026-0001",
      delivered: true,
    });
  });

  it("no atribuye un POD único si la CPU se repartió entre dos pedidos", async () => {
    __setAdminClient(db({ custody_allocation_physical_units: bridge() }));
    __setSessionClient(db({
      custody_physical_units: [{ id: UNIT, quantity: 10 }],
      stock_allocations: allocations(ORDER_B),
      shipments: [],
    }));
    await expect(resolvePhysicalUnitPodShipment(UNIT)).resolves.toBeNull();
  });

  it("no atribuye POD mientras una fracción siga empacada", async () => {
    __setAdminClient(db({ custody_allocation_physical_units: bridge() }));
    __setSessionClient(db({
      custody_physical_units: [{ id: UNIT, quantity: 10 }],
      stock_allocations: allocations(ORDER_A, "empacada"),
      shipments: [],
    }));
    await expect(resolvePhysicalUnitPodShipment(UNIT)).resolves.toBeNull();
  });

  it("una cantidad del puente distinta de la allocation queda no verificable", async () => {
    __setAdminClient(db({ custody_allocation_physical_units: bridge() }));
    __setSessionClient(db({
      custody_physical_units: [{ id: UNIT, quantity: 10 }],
      stock_allocations: allocations(ORDER_A, "despachada", 6),
      shipments: [],
    }));
    await expect(resolvePhysicalUnitPodShipment(UNIT)).resolves.toBeNull();
  });
});
