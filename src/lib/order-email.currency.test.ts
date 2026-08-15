import { describe, expect, it } from "vitest";
import { renderRoleHtml, renderRoleText } from "./order-email";
import type { Order } from "./types";

const USD_ORDER = {
  id: "00000000-0000-0000-0000-000000000066",
  public_id: "OS-USD-000066",
  short_id: 66,
  date: "2026-08-15T12:00:00Z",
  depot: "MAGALDI",
  status: "FIRMADA",
  client_id: "00000000-0000-0000-0000-0000000000c1",
  operator_id: null,
  h_start: "08:00",
  h_end: "12:00",
  hours: 4,
  pallets: 0,
  units: 0,
  km: 0,
  observ: null,
  total: 1234.5,
  pricing_currency: "USD",
  signed_by: "Cliente Demo",
  signed_doc: null,
  signed_at: "2026-08-15T12:00:00Z",
  signature_url: null,
  signature_hash: null,
  pdf_url: null,
  geo_lat: null,
  geo_lng: null,
  ip: null,
  created_at: "2026-08-15T12:00:00Z",
  created_by: null,
  client: { razon: "Cliente Demo" },
  services: [
    {
      service_slug: "servicio-usd",
      label: "Servicio USD",
      qty: 1,
      unit: "un",
      rate: 1234.5,
      subtotal: 1234.5,
      currency_snapshot: "USD",
    },
  ],
} as Order;

describe("order email currency snapshot", () => {
  it("comunica USD sin rotular ni formatear el importe como ARS", () => {
    const text = renderRoleText(USD_ORDER, "facturacion", "https://example.test/orders/66");
    const html = renderRoleHtml(USD_ORDER, "facturacion", "https://example.test/orders/66");
    const normalizedText = text.replace(/\u00a0/g, " ");

    expect(normalizedText).toContain("Moneda: USD");
    expect(normalizedText).toContain("US$ 1.234,50");
    expect(html).toContain("US$");
    expect(normalizedText).not.toContain("Subtotal neto: $ 1.235");
  });

  it("falla cerrado cuando una orden legada no acredita moneda", () => {
    const orderWithoutCurrency = {
      ...USD_ORDER,
      pricing_currency: undefined,
      services: USD_ORDER.services?.map((service) => ({
        ...service,
        currency_snapshot: undefined,
      })),
    } as unknown as Order;
    const text = renderRoleText(
      orderWithoutCurrency,
      "facturacion",
      "https://example.test/orders/66",
    );
    const html = renderRoleHtml(
      orderWithoutCurrency,
      "facturacion",
      "https://example.test/orders/66",
    );

    expect(text).toContain("Moneda: NO INFORMADA");
    expect(text).toContain("Subtotal neto: IMPORTE SIN MONEDA");
    expect(html).toContain("NO INFORMADA");
    expect(html).toContain("IMPORTE SIN MONEDA");
  });
});
