import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { PurchaseOrder } from "@/lib/types-po";
import { PoPdfDocument } from "@/lib/compras/pdf/PoPdfDocument";
import { pdfText, hasPhrase } from "@/lib/doc-system/pdf-text";

/**
 * Render de muestras del doc-system con datos ficticios.
 * Además de servir como smoke test de que cada documento renderiza,
 * si DOC_SAMPLES_OUT está definido escribe los PDF para validación
 * visual contra las referencias de Dirección.
 */

const OUT = process.env.DOC_SAMPLES_OUT ?? "";

function maybeWrite(name: string, buf: Buffer) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), buf);
}

const PO_FIXTURE = {
  public_id: "OC-2026-0007",
  date: "2026-07-24T20:27:00-03:00",
  categoria: "Combustible",
  destino: "Depósito Magaldi · CABA",
  cond_pago: "30 días",
  entrega: "Inmediata",
  vendor: {
    razon: "Proveedor Demo S.A.",
    domicilio: "Av. Demo 500",
    cuit: "30555555551",
    telefono: null,
    contacto: "Contacto Demo",
    email: "compras@proveedor.example",
  },
  items: [
    {
      label: "Tanque lleno de nafta",
      sku: "AC864SK",
      qty: 1,
      unit: "un",
      price: 1250000,
      subtotal: 1250000,
    },
    {
      label: "Filtro de combustible",
      sku: null,
      qty: 4,
      unit: "un",
      price: 38500,
      subtotal: 154000,
    },
  ],
  neto: 1404000,
  iva: 294840,
  total: 1698840,
  observ: "Entregar en portón 2 · coordinación previa con depósito.",
  signed_at: "2026-07-24T20:27:00-03:00",
  recibido_por: null,
  recibido_at: null,
  factura_id: null,
  integrity_hash: "0000000000000000000000000000000000000000000000000000000000000002",
  drive_file_id: null,
} as unknown as PurchaseOrder;

describe("doc-system render samples", () => {
  it("renderiza la Orden de Compra con el sistema común", async () => {
    const qr = await QRCode.toDataURL("https://example.test/compras/validar/OC-2026-0007", {
      margin: 0,
      width: 240,
    });
    const buf = await renderToBuffer(<PoPdfDocument po={PO_FIXTURE} qrDataUrl={qr} />);
    const txt = await pdfText(buf);
    expect(hasPhrase(txt, "ORDEN DE")).toBe(true);
    expect(hasPhrase(txt, "OC-2026-0007")).toBe(true);
    expect(hasPhrase(txt, "1.698.840")).toBe(true);
    maybeWrite("oc-sample.pdf", buf);
  });
});
