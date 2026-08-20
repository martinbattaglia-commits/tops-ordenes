import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error stub inyectado por alias en vitest.wms-ui.config.ts
import { __setAdminClient, __setSessionClient } from "@/lib/supabase/server";
import {
  getAllocationCustodyVisibility,
  getCanonicalPhysicalUnitQr,
  getInventoryCustodyVisibility,
} from "@/lib/custody/operation-visibility";

type Row = Record<string, unknown>;

const ALLOC_A = "11111111-1111-4111-8111-111111111111";
const ALLOC_B = "22222222-2222-4222-8222-222222222222";
const INV_A = "33333333-3333-4333-8333-333333333333";
const INV_B = "44444444-4444-4444-8444-444444444444";
const UNIT_N1 = "55555555-5555-4555-8555-555555555555";
const UNIT_N2_A = "66666666-6666-4666-8666-666666666666";
const UNIT_N2_B = "77777777-7777-4777-8777-777777777777";
const UNIT_FOREIGN = "88888888-8888-4888-8888-888888888888";
const CASE_A = "99999999-9999-4999-8999-999999999999";
const CASE_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function pick(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value === null || value === undefined) return undefined;
    return (value as Row)[key];
  }, row);
}

function client(
  tables: Record<string, Row[]>,
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
) {
  const calls: Array<{ table: string; op: "eq" | "in"; column: string; value: unknown }> = [];
  return {
    calls,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const rows = tables[table] ?? [];
      const resolve = () => rows.filter((row) => filters.every((filter) => filter(row)));
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.order = () => query;
      query.eq = (column: string, value: unknown) => {
        calls.push({ table, op: "eq", column, value });
        filters.push((row) => pick(row, column) === value);
        return query;
      };
      query.in = (column: string, values: unknown[]) => {
        calls.push({ table, op: "in", column, value: values });
        filters.push((row) => values.includes(pick(row, column)));
        return query;
      };
      query.then = (done: (value: { data: Row[]; error: null }) => unknown) =>
        done({ data: resolve(), error: null });
      return query;
    },
    rpc: rpc ?? (async () => ({ data: null, error: new Error("RPC inesperada") })),
  };
}

function unit(id: string, publicId: string, inventoryItemId: string, level: number): Row {
  return {
    id,
    public_id: publicId,
    inventory_item_id: inventoryItemId,
    custody_level: level,
  };
}

function integrityCase(id: string, publicId: string, physicalUnitId: string): Row {
  return { id, public_id: publicId, physical_unit_id: physicalUnitId, state: "RELEASED" };
}

beforeEach(() => {
  __setSessionClient(null);
  __setAdminClient(null);
});

describe("visibilidad N2 por allocation", () => {
  it("acota el puente, filtra N1 y conserva dos CPU/CINT sin mezclar tenants", async () => {
    __setSessionClient(
      client({
        stock_allocations: [{ id: ALLOC_A }, { id: ALLOC_B }],
        custody_physical_units: [
          unit(UNIT_N1, "CPU-N1", INV_A, 1),
          unit(UNIT_N2_A, "CPU-N2-A", INV_A, 2),
          unit(UNIT_N2_B, "CPU-N2-B", INV_A, 2),
          unit(UNIT_FOREIGN, "CPU-AJENA", INV_B, 2),
        ],
        custody_integrity_cases: [
          integrityCase(CASE_A, "CINT-A", UNIT_N2_A),
          integrityCase(CASE_B, "CINT-B", UNIT_N2_B),
          integrityCase("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "CINT-AJENO", UNIT_FOREIGN),
        ],
      }),
    );
    const admin = client({
        custody_allocation_physical_units: [
          { allocation_id: ALLOC_A, physical_unit_id: UNIT_N1 },
          { allocation_id: ALLOC_A, physical_unit_id: UNIT_N2_A },
          { allocation_id: ALLOC_A, physical_unit_id: UNIT_N2_B },
          { allocation_id: ALLOC_B, physical_unit_id: UNIT_FOREIGN },
        ],
      });
    __setAdminClient(admin);

    const result = await getAllocationCustodyVisibility([ALLOC_A]);
    expect(result.status).toBe("available");
    expect(result.byAllocation[ALLOC_A].map((row) => row.unitPublicId)).toEqual([
      "CPU-N2-A",
      "CPU-N2-B",
    ]);
    expect(result.byAllocation[ALLOC_A].map((row) => row.casePublicId)).toEqual([
      "CINT-A",
      "CINT-B",
    ]);
    expect(JSON.stringify(result)).not.toContain("CPU-N1");
    expect(JSON.stringify(result)).not.toContain("CPU-AJENA");
    expect(admin.calls).toContainEqual({
      table: "custody_allocation_physical_units",
      op: "in",
      column: "allocation_id",
      value: [ALLOC_A],
    });
  });

  it("N2 sin caso conserva la CPU y marca CINT ausente", async () => {
    __setSessionClient(
      client({
        stock_allocations: [{ id: ALLOC_A }],
        custody_physical_units: [unit(UNIT_N2_A, "CPU-N2-A", INV_A, 2)],
        custody_integrity_cases: [],
      }),
    );
    __setAdminClient(
      client({
        custody_allocation_physical_units: [
          { allocation_id: ALLOC_A, physical_unit_id: UNIT_N2_A },
        ],
      }),
    );

    const result = await getAllocationCustodyVisibility([ALLOC_A]);
    expect(result.byAllocation[ALLOC_A]).toHaveLength(1);
    expect(result.byAllocation[ALLOC_A][0].caseId).toBeNull();
  });

  it("cliente admin ausente es unavailable, no vacío verificable", async () => {
    __setSessionClient(client({ stock_allocations: [{ id: ALLOC_A }] }));
    __setAdminClient(null);

    await expect(getAllocationCustodyVisibility([ALLOC_A])).resolves.toEqual({
      status: "unavailable",
      byAllocation: {},
    });
  });
});

describe("visibilidad N2 y QR por inventario", () => {
  it("N1 nunca pide token ni recibe QR", async () => {
    const calls: string[] = [];
    __setSessionClient(
      client(
        {
          inventory_items: [{ id: INV_A }],
          custody_physical_units: [unit(UNIT_N1, "CPU-N1", INV_A, 1)],
          custody_integrity_cases: [],
        },
        async (name) => {
          calls.push(name);
          return { data: null, error: new Error("no debe llamarse") };
        },
      ),
    );

    const result = await getInventoryCustodyVisibility([INV_A]);
    expect(result.status).toBe("available");
    expect(result.byInventoryItem[INV_A]).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("dos N2 quedan visibles y el QR se resuelve bajo demanda sin exponer token", async () => {
    const calls: string[] = [];
    __setSessionClient(
      client(
        {
          inventory_items: [{ id: INV_A }],
          custody_physical_units: [
            unit(UNIT_N2_A, "CPU-N2-A", INV_A, 2),
            unit(UNIT_N2_B, "CPU-N2-B", INV_A, 2),
          ],
          custody_integrity_cases: [
            integrityCase(CASE_A, "CINT-A", UNIT_N2_A),
            integrityCase(CASE_B, "CINT-B", UNIT_N2_B),
          ],
        },
        async (name, args) => {
          calls.push(`${name}:${String(args.p_physical_unit_id)}`);
          if (args.p_physical_unit_id === UNIT_N2_A) return { data: TOKEN_A, error: null };
          if (args.p_physical_unit_id === UNIT_N2_B) return { data: TOKEN_B, error: null };
          return { data: null, error: new Error("unidad inesperada") };
        },
      ),
    );

    const result = await getInventoryCustodyVisibility([INV_A]);
    const units = result.byInventoryItem[INV_A];
    expect(units).toHaveLength(2);
    expect(calls).toEqual([]);

    const qrA = await getCanonicalPhysicalUnitQr(UNIT_N2_A);
    const qrB = await getCanonicalPhysicalUnitQr(UNIT_N2_B);
    expect(qrA?.url).toContain(TOKEN_A);
    expect(qrB?.url).toContain(TOKEN_B);
    expect(qrA?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(qrB?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(calls).toEqual([
      `get_custody_physical_token:${UNIT_N2_A}`,
      `get_custody_physical_token:${UNIT_N2_B}`,
    ]);
    expect(Object.prototype.hasOwnProperty.call(units[0], "token")).toBe(false);
  });

  it("un token no canónico no se convierte en link", async () => {
    __setSessionClient(
      client(
        {
          inventory_items: [{ id: INV_A }],
          custody_physical_units: [unit(UNIT_N2_A, "CPU-N2-A", INV_A, 2)],
          custody_integrity_cases: [integrityCase(CASE_A, "CINT-A", UNIT_N2_A)],
        },
        async () => ({ data: `${TOKEN_A}\n`, error: null }),
      ),
    );

    const result = await getCanonicalPhysicalUnitQr(UNIT_N2_A);
    expect(result).toBeNull();
  });
});
