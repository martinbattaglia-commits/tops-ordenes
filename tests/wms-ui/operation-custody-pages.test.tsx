import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inventory: vi.fn(),
  receptions: vi.fn(),
  receptionUnits: vi.fn(),
  pickRoute: vi.fn(),
  packBoard: vi.fn(),
  inventoryVisibility: vi.fn(),
  allocationVisibility: vi.fn(),
  qr: vi.fn(),
}));

vi.mock("@/lib/wms/data", () => ({ listInventory: mocks.inventory }));
vi.mock("@/lib/wms/receptions", () => ({ listReceptions: mocks.receptions }));
vi.mock("@/app/(app)/wms/recepciones/actions", () => ({
  receptionCustodyUnitsAction: mocks.receptionUnits,
}));
vi.mock("@/app/(app)/wms/recepciones/_components/RowActions", () => ({
  RowActions: () => null,
}));
vi.mock("@/lib/picking/picking", () => ({ listPickRoute: mocks.pickRoute }));
vi.mock("@/app/(app)/wms/picking/_components/PickingActions", () => ({
  PickStopButton: () => <span data-pick-action="true">Pickear</span>,
  PickOrderButton: () => null,
}));
vi.mock("@/lib/packing/packing", () => ({ listPackBoard: mocks.packBoard }));
vi.mock("@/lib/custody/operation-visibility", () => ({
  getInventoryCustodyVisibility: mocks.inventoryVisibility,
  getAllocationCustodyVisibility: mocks.allocationVisibility,
  getCanonicalPhysicalUnitQr: mocks.qr,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("notFound inesperado"); },
}));

import InventarioPage from "@/app/(app)/wms/inventario/page";
import RecepcionesPage from "@/app/(app)/wms/recepciones/page";
import PickRoutePage from "@/app/(app)/wms/picking/[id]/page";
import PackRoutePage from "@/app/(app)/wms/packing/[id]/page";

const INVENTORY = "11111111-1111-4111-8111-111111111111";
const RECEPTION = "22222222-2222-4222-8222-222222222222";
const ALLOCATION = "33333333-3333-4333-8333-333333333333";
const UNIT = "44444444-4444-4444-8444-444444444444";
const CASE = "55555555-5555-4555-8555-555555555555";
const ORDER = "66666666-6666-4666-8666-666666666666";

const location = {
  warehouse_code: "WH",
  warehouse_name: "Depósito",
  floor_code: "P1",
  floor_level: 1,
  sector_code: "S1",
  zone_code: "Z1",
  rack_code: "R1",
  rack_level: 1,
  rack_column: 1,
  position_code: "A1",
  position_id: "position",
  full_code: "WH·P1·S1·Z1·R1·A1",
};

const n2 = {
  physicalUnitId: UNIT,
  unitPublicId: "CPU-2026-0001",
  inventoryItemId: INVENTORY,
  custodyLevel: 2,
  caseId: CASE,
  casePublicId: "CINT-2026-0001",
  caseState: "RELEASED",
  qrDataUrl: null,
  qrUrl: null,
};

const stop = {
  allocation_id: ALLOCATION,
  status: "reservada",
  order_item_id: "item",
  sku: "SKU-1",
  description: "Producto",
  lot_number: null,
  quantity: 1,
  inventory_item_id: INVENTORY,
  location,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inventoryVisibility.mockResolvedValue({ status: "available", byInventoryItem: {} });
  mocks.allocationVisibility.mockResolvedValue({ status: "available", byAllocation: {} });
  mocks.qr.mockResolvedValue({ dataUrl: "data:image/png;base64,AA==", url: "/c/opaque-fixture" });
});

describe("R6-R8 · cableado real de Server Components", () => {
  it("recupera en Recepciones la CPU, su CINT y el QR imprimible exactos", async () => {
    mocks.receptions.mockResolvedValue([{
      id: RECEPTION,
      public_id: "REC-2026-0001",
      client_name: "Cliente",
      business_unit: "GENERAL",
      status: "recibida",
      numero_oc: null,
      numero_remito: null,
      transportista: null,
      patente: null,
      chofer: null,
      requires_quarantine: false,
      received_at: "2026-08-20T10:00:00.000Z",
      created_at: "2026-08-20T09:00:00.000Z",
      item_count: 1,
      received_count: 1,
      custody_reforzada: true,
      custody_units: 1,
      custody_units_con_foto: 1,
    }]);
    mocks.receptionUnits.mockResolvedValue({
      ok: true,
      data: [{
        physicalUnitId: UNIT,
        receptionItemId: "77777777-7777-4777-8777-777777777777",
        unitPublicId: "CPU-2026-0001",
        sku: "SKU-1",
        quantity: 1,
        lotNumber: null,
        custodyLevel: 2,
        caseId: CASE,
        casePublicId: "CINT-2026-0001",
        caseState: "RELEASED",
        hasIngressPhoto: true,
        qrDataUrl: "data:image/png;base64,AA==",
        qrUrl: "/c/opaque-fixture",
      }],
    });

    const html = renderToStaticMarkup(await RecepcionesPage({ searchParams: { custodia: RECEPTION } }));
    expect(mocks.receptionUnits).toHaveBeenCalledWith(RECEPTION);
    expect(html).toContain(`data-qr-cpu="${UNIT}"`);
    expect(html).toContain("CPU-2026-0001");
    expect(html).toContain("CINT-2026-0001");
    expect(html).toContain(`/wms/custody/${CASE}`);
    expect(html).toContain("Imprimir");
    expect(html).toContain(`/wms/recepciones?custodia=${RECEPTION}#custodia-recepcion`);
  });

  it("inventario muestra N2/CPU/CINT/QR y no los fabrica para una fila N1", async () => {
    mocks.inventory.mockResolvedValue([
      {
        id: INVENTORY,
        sku: "SKU-N2",
        description: "Producto N2",
        client_name: "Cliente",
        stock_available: 1,
        stock_reserved: 0,
        lot_number: null,
        expiration_date: null,
        lot_count: 0,
        position_id: null,
        position_full_code: null,
      },
      {
        id: "88888888-8888-4888-8888-888888888888",
        sku: "SKU-N1",
        description: "Producto N1",
        client_name: "Cliente",
        stock_available: 1,
        stock_reserved: 0,
        lot_number: null,
        expiration_date: null,
        lot_count: 0,
        position_id: null,
        position_full_code: null,
      },
    ]);
    mocks.inventoryVisibility.mockResolvedValue({
      status: "available",
      byInventoryItem: { [INVENTORY]: [n2] },
    });

    const html = renderToStaticMarkup(await InventarioPage({ searchParams: { qr: UNIT } }));
    expect(mocks.inventoryVisibility).toHaveBeenCalledWith([
      INVENTORY,
      "88888888-8888-4888-8888-888888888888",
    ]);
    expect(mocks.qr).toHaveBeenCalledWith(UNIT);
    expect(html).toContain(`data-custodia-n2="${INVENTORY}"`);
    expect(html).toContain("CPU-2026-0001");
    expect(html).toContain("CINT-2026-0001");
    expect(html).toContain("QR canónico de la unidad");
    const n1Row = html.slice(html.indexOf("SKU-N1"));
    expect(n1Row).not.toContain("data-custodia-n2");
  });

  it("picking pasa la proyección por allocation y preserva la acción N1", async () => {
    mocks.pickRoute.mockResolvedValue({
      order_id: ORDER,
      public_id: "ORD-2026-0001",
      client_name: "Cliente",
      status: "en_preparacion",
      priority: 0,
      stops: [stop],
    });
    mocks.allocationVisibility.mockResolvedValue({
      status: "available",
      byAllocation: { [ALLOCATION]: [n2] },
    });

    const html = renderToStaticMarkup(await PickRoutePage({ params: { id: ORDER } }));
    expect(mocks.allocationVisibility).toHaveBeenCalledWith([ALLOCATION]);
    expect(html).toContain(`data-custodia-n2="${ALLOCATION}"`);
    expect(html).toContain("CPU-2026-0001");
    expect(html).toContain("CINT-2026-0001");
    expect(html).toContain(`/wms/custody/${CASE}`);
    expect(html).toContain("data-pick-action=\"true\"");
  });

  it("packing conecta pendientes y contenido ya empacado con la misma proyección", async () => {
    mocks.packBoard.mockResolvedValue({
      order_id: ORDER,
      public_id: "ORD-2026-0001",
      client_name: "Cliente",
      status: "en_preparacion",
      priority: 0,
      pending_stops: [stop],
      units: [],
    });
    mocks.allocationVisibility.mockResolvedValue({
      status: "available",
      byAllocation: { [ALLOCATION]: [n2] },
    });

    const html = renderToStaticMarkup(await PackRoutePage({ params: { id: ORDER } }));
    expect(mocks.allocationVisibility).toHaveBeenCalledWith([ALLOCATION]);
    expect(html).toContain('data-custodia-n2="true"');
    expect(html).toContain("CPU-2026-0001");
    expect(html).toContain("CINT-2026-0001");
    expect(html).toContain("Crear y empacar");
  });
});
