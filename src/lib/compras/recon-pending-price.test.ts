import { describe, expect, it } from "vitest";
import { computeRecon } from "../recon/diff-engine";
import type { InvoiceForRecon, POForRecon } from "../recon/types";

const invoice: InvoiceForRecon = {
  id: "inv", public_id: "FP-1", vendor_id: "v1", tipo_comprobante: "FACTURA_A",
  punto_venta: 1, numero: "1", cae: "123", fecha_emision: "2026-08-14",
  neto: 100, iva: 21, total: 121,
};

describe("conciliación de OC sin precio", () => {
  it("no representa los importes pendientes como diferencias contra cero", () => {
    const po: POForRecon = {
      id: "po", public_id: "OC-1", vendor_id: "v1", neto: null, iva: null,
      total: null, price_state: "pending", items: [],
    };
    const result = computeRecon(po, invoice);
    expect(result.diffs).toContainEqual(expect.objectContaining({
      field: "precio_unitario", val_oc: "pendiente de precio", val_factura: "121",
    }));
    expect(result.diffs.some((d) => d.field === "total" && d.val_oc === "0")).toBe(false);
  });
});
