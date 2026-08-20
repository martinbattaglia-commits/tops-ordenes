import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PackBoard } from "@/app/(app)/wms/packing/_components/PackBoard";
import { DispatchActions } from "@/app/(app)/wms/despachos/_components/DispatchActions";
import { DispatchEgressPanel } from "@/app/(app)/wms/despachos/_components/DispatchEgressPanel";
import type { PackStop } from "@/lib/packing/types";
import type { CustodyOperationalUnit } from "@/lib/custody/operation-visibility";

const ORDER = "11111111-1111-4111-8111-111111111111";
const ALLOC = "22222222-2222-4222-8222-222222222222";
const UNIT = "33333333-3333-4333-8333-333333333333";
const CASE = "44444444-4444-4444-8444-444444444444";

const stop: PackStop = {
  allocation_id: ALLOC,
  status: "pickeada",
  order_item_id: "item",
  sku: "SKU",
  description: "Producto",
  lot_number: null,
  quantity: 1,
  inventory_item_id: "inventory",
  location: {
    warehouse_code: null,
    warehouse_name: null,
    floor_code: null,
    floor_level: null,
    sector_code: null,
    zone_code: null,
    rack_code: null,
    rack_level: null,
    rack_column: null,
    position_code: null,
    position_id: null,
    full_code: null,
  },
};

const n2: CustodyOperationalUnit = {
  physicalUnitId: UNIT,
  unitPublicId: "CPU-2026-0001",
  inventoryItemId: "inventory",
  custodyLevel: 2,
  caseId: CASE,
  casePublicId: "CINT-2026-0001",
  caseState: "RELEASED",
  qrDataUrl: null,
  qrUrl: null,
};

describe("señalización N2 no mutante", () => {
  it("packing N1 queda sin badge y conserva su acción", () => {
    const html = renderToStaticMarkup(
      <PackBoard
        orderId={ORDER}
        status="en_preparacion"
        pendingStops={[stop]}
        units={[]}
        custodyStatus="available"
        custodyByAllocation={{}}
      />,
    );
    expect(html).not.toContain("data-custodia-n2");
    expect(html).toContain("Crear y empacar");
  });

  it("packing muestra CPU y CINT exactos sin agregar gate", () => {
    const html = renderToStaticMarkup(
      <PackBoard
        orderId={ORDER}
        status="en_preparacion"
        pendingStops={[stop]}
        units={[]}
        custodyStatus="available"
        custodyByAllocation={{ [ALLOC]: [n2] }}
      />,
    );
    expect(html).toContain("data-custodia-n2");
    expect(html).toContain("CPU-2026-0001");
    expect(html).toContain("CINT-2026-0001");
    expect(html).toContain(`/wms/custody/${CASE}`);
    expect(html).toContain("Crear y empacar");
  });

  it("packing distingue lectura no verificable de mercadería N1", () => {
    const html = renderToStaticMarkup(
      <PackBoard
        orderId={ORDER}
        status="en_preparacion"
        pendingStops={[stop]}
        units={[]}
        custodyStatus="unavailable"
        custodyByAllocation={{}}
      />,
    );
    expect(html).toContain("Custodia no verificable");
    expect(html).toContain("CPU/CINT");
  });

  it("picking consume la proyección por allocation y no altera PickStopButton", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(app)/wms/picking/[id]/page.tsx"),
      "utf8",
    );
    expect(source).toContain("getAllocationCustodyVisibility");
    expect(source).toContain("custody.byAllocation[st.allocation_id]");
    expect(source).toContain("<PickStopButton");
  });
});

describe("despacho fail-closed y navegación CINT", () => {
  it("N1/no aplica conserva el botón histórico", () => {
    const html = renderToStaticMarkup(
      <DispatchActions
        orderId={ORDER}
        orderStatus="preparado"
        allClosed
        openUnits={0}
        shipment={null}
        custodyStatus="not_applicable"
        custodyAllAllowed
      />,
    );
    expect(html).toContain("Despachar");
  });

  it.each([
    ["unavailable" as const, true, "Custodia no verificable"],
    ["required" as const, false, "Resolvé la liberación CINT"],
  ])("%s no presenta botón de despacho", (status, allowed, message) => {
    const html = renderToStaticMarkup(
      <DispatchActions
        orderId={ORDER}
        orderStatus="preparado"
        allClosed
        openUnits={0}
        shipment={null}
        custodyStatus={status}
        custodyAllAllowed={allowed}
      />,
    );
    expect(html).not.toMatch(/>Despachar</);
    expect(html).toContain(message);
  });

  it("cada CPU enlaza sólo su CINT y transporta un UUID de pedido", () => {
    const html = renderToStaticMarkup(
      <DispatchEgressPanel
        orderId={ORDER}
        status="required"
        allAllowed={false}
        units={[
          {
            physicalUnitId: UNIT,
            unitPublicId: "CPU-2026-0001",
            sku: "SKU",
            caseId: CASE,
            casePublicId: "CINT-2026-0001",
            hasIngressPhoto: true,
            hasEgressPhoto: false,
            blockers: ["Falta decisión humana"],
            dispatchAllowed: false,
          },
        ]}
      />,
    );
    expect(html).toContain(`/wms/custody/${CASE}?dispatchOrderId=${ORDER}`);
    expect(html).toContain("CINT-2026-0001");
  });

  it("entrega queda bloqueada por el mismo gate, sin ocultar la reversión", () => {
    const shipment = {
      id: "55555555-5555-4555-8555-555555555555",
      public_id: "DSP-2026-0001",
      status: "despachado" as const,
      carrier: null,
      vehicle_ref: null,
      dispatched_at: "2026-08-20T10:00:00.000Z",
      delivered_at: null,
      received_by_name: null,
    };
    const blocked = renderToStaticMarkup(
      <DispatchActions
        orderId={ORDER}
        orderStatus="despachado"
        allClosed
        openUnits={0}
        shipment={shipment}
        custodyStatus="required"
        custodyAllAllowed={false}
      />,
    );
    expect(blocked).not.toMatch(/>Entregar</);
    expect(blocked).toContain("entrega bloqueada");
    expect(blocked).toContain("Revertir despacho");

    const released = renderToStaticMarkup(
      <DispatchActions
        orderId={ORDER}
        orderStatus="despachado"
        allClosed
        openUnits={0}
        shipment={shipment}
        custodyStatus="required"
        custodyAllAllowed
      />,
    );
    expect(released).toContain(" Entregar</button>");
  });
});
