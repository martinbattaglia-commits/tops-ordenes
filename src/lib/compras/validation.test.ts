import { describe, expect, it } from "vitest";
import { CreatePurchaseOrderSchema } from "./validation";
import { CreateOrderSchema } from "@/lib/validation/order";

const HASH = "a".repeat(64);
const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function purchaseInput(qty: unknown, price: unknown = 10) {
  return {
    vendor: {
      id: "11111111-1111-4111-8111-111111111111",
      razon: "Proveedor Canónico",
      cuit: "30-70000001-5",
      domicilio: "Domicilio",
      telefono: "",
      contacto: "Compras",
      email: "compras@proveedor.test",
    },
    depot: "MAGALDI",
    destino: "dato no autoritativo",
    entrega: "Inmediata",
    categoria: "Insumos",
    cond_pago: "30 días",
    items: [{
      sku: null,
      label: "Producto",
      unit: "un",
      qty,
      price,
      subtotal: price == null ? null : 10,
      price_state: price == null ? "pending" : "known",
      price_reason: price == null ? "Cotización pendiente" : null,
      pos: 0,
    }],
    observ: "",
    signature: { signed_by: "Responsable", data_url: PNG_1X1, hash: HASH },
  };
}

function serviceInput(qty: unknown) {
  return {
    pricing_version_id: "22222222-2222-4222-8222-222222222222",
    client: {
      id: "33333333-3333-4333-8333-333333333333",
      razon: "Cliente",
      cuit: "30-71181219-5",
      domicilio: "",
      telefono: "",
      contacto: "",
      email: "cliente@example.com",
    },
    depot: "MAGALDI",
    operator_id: "44444444-4444-4444-8444-444444444444",
    services: [{
      service_slug: "peon",
      label: "Peón",
      qty,
      qty_requested: qty,
      unit: "hs",
      rate: 30000,
      subtotal: 30000,
      pricing_kind: "catalog",
      expected_tariff_rate_id: "55555555-5555-4555-8555-555555555555",
      expected_client_rate_id: null,
    }],
    h_start: "08:00",
    h_end: "12:00",
    pallets: 0,
    units: 0,
    km: 0,
    observ: "",
    total: 30000,
    signature: {
      signed_by: "Firmante",
      signed_doc: null,
      data_url: "data:image/png;base64,AA==",
      hash: HASH,
      geo_lat: null,
      geo_lng: null,
    },
  };
}

describe("cantidades y precios fail-closed", () => {
  for (const invalid of [undefined, null, "", "texto", Number.NaN, Infinity, 0, -1, 1.001, 10_000_000_000]) {
    it(`rechaza cantidad OC inválida: ${String(invalid)}`, () => {
      expect(CreatePurchaseOrderSchema.safeParse(purchaseInput(invalid)).success).toBe(false);
    });
    it(`rechaza cantidad OS inválida: ${String(invalid)}`, () => {
      expect(CreateOrderSchema.safeParse(serviceInput(invalid)).success).toBe(false);
    });
  }

  it("acepta cantidades decimales explícitas con hasta dos posiciones", () => {
    expect(CreatePurchaseOrderSchema.safeParse(purchaseInput("1.25")).success).toBe(true);
    expect(CreateOrderSchema.safeParse(serviceInput("1.25")).success).toBe(true);
  });

  for (const invalid of ["texto", Number.NaN, Infinity, -1, 1.001, 1_000_000_000_000]) {
    it(`un precio malformado no se convierte en pendiente: ${String(invalid)}`, () => {
      const parsed = CreatePurchaseOrderSchema.safeParse(purchaseInput(1, invalid));
      expect(parsed.success).toBe(false);
    });
  }

  it("sólo una ausencia explícita representa precio pendiente", () => {
    const parsed = CreatePurchaseOrderSchema.safeParse(purchaseInput(1, null));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.items[0].price).toBeNull();
  });

  it("rechaza firma que no sea base64 PNG acotado antes de llegar a PostgreSQL", () => {
    const malformed = purchaseInput(1) as ReturnType<typeof purchaseInput>;
    malformed.signature.data_url = "data:image/png;base64,***";
    expect(CreatePurchaseOrderSchema.safeParse(malformed).success).toBe(false);

    const oversized = purchaseInput(1) as ReturnType<typeof purchaseInput>;
    oversized.signature.data_url = `data:image/png;base64,${"A".repeat(700_004)}`;
    expect(CreatePurchaseOrderSchema.safeParse(oversized).success).toBe(false);
  });
});
