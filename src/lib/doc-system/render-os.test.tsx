import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { Order } from "@/lib/types";
import { OrderPdfDocument } from "@/lib/pdf/OrderPdfDocument";
import { pdfText, hasPhrase } from "@/lib/doc-system/pdf-text";

/**
 * Render de muestra de la Orden de Servicio con datos ficticios (tipo
 * OS-000004). Smoke test de que el documento renderiza con el doc-system;
 * si DOC_SAMPLES_OUT está definido escribe el PDF para validación visual.
 */

const OUT = process.env.DOC_SAMPLES_OUT ?? "";

function maybeWrite(name: string, buf: Buffer) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), buf);
}

const ORDER_FIXTURE = {
  id: "00000000-0000-0000-0000-000000000004",
  public_id: "OS-000004",
  short_id: 4,
  date: "2026-07-24T10:32:00-03:00",
  depot: "LUJAN",
  status: "FIRMADA",
  client_id: "00000000-0000-0000-0000-0000000000c1",
  operator_id: "00000000-0000-0000-0000-0000000000a1",
  h_start: "08:00",
  h_end: "12:00",
  hours: 4,
  pallets: 0,
  units: 0,
  km: 0,
  observ: "DEPOSITO DE ANMAT · ALMACENAJE DE MERCADERIA JUNIO Y JULIO: DEPOSITO DE ANMAT",
  total: 1139046,
  signed_by: "Operador Demo",
  signed_doc: null,
  signed_at: "2026-07-24T10:32:00-03:00",
  signature_url: null,
  signature_hash: "0000000000000000000000000000000000000000000000000000000000000001",
  pdf_url: null,
  geo_lat: null,
  geo_lng: null,
  ip: "192.0.2.10",
  created_at: "2026-07-24T10:00:00-03:00",
  created_by: null,
  client: {
    razon: "Laboratorio Demo S.R.L.",
    cuit: "30222222229",
    domicilio: "Calle Demo 100 · Ciudad Demo",
    contacto: "Contacto Demo",
  },
  operator: {
    full_name: "Operador Demo",
  },
  services: [
    {
      service_slug: "almacenaje",
      label: "ALMACENAJE DE MERCADERIA JUNIO Y JULIO",
      qty: 1,
      unit: "un",
      rate: 1139046,
      subtotal: 1139046,
    },
  ],
} as unknown as Order;

describe("doc-system render OS", () => {
  it("renderiza la Orden de Servicio con el sistema común", async () => {
    const qr = await QRCode.toDataURL("https://example.test/orders/OS-000004", {
      margin: 1,
      color: { dark: "#050555", light: "#ffffff" },
      width: 280,
    });
    const buf = await renderToBuffer(<OrderPdfDocument order={ORDER_FIXTURE} qrDataUrl={qr} />);
    const txt = await pdfText(buf);
    expect(hasPhrase(txt, "ORDEN DE")).toBe(true);
    expect(hasPhrase(txt, "OS-000004")).toBe(true);
    expect(hasPhrase(txt, "SEGURO DE LAS MERCADERÍAS")).toBe(true);
    expect(hasPhrase(txt, "192.0.2.10")).toBe(true);
    maybeWrite("os-sample.pdf", buf);
  });
});
