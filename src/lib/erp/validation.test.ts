import { describe, it, expect } from "vitest";
import { CreateSupplierInvoiceSchema, formatZodIssues } from "./validation";

// Payload mínimo válido (espejo de lo que arma NuevaFacturaForm).
const VALID = {
  vendor_id: "11111111-1111-1111-1111-111111111111",
  tipo_comprobante: "FACTURA_A",
  punto_venta: 1,
  numero: "00000001",
  fecha_emision: "2026-06-28",
  importe_no_gravado: 0,
  importe_exento: 0,
  vat_lines: [{ alic_iva_id: 5, alicuota_iva: 21, base_neto: 10000, importe_iva: 2100 }],
  other_taxes: [],
  items: [],
};

describe("Factura proveedor — validación y mensajes de error", () => {
  it("acepta un payload válido (caso general OK)", () => {
    expect(CreateSupplierInvoiceSchema.safeParse(VALID).success).toBe(true);
  });

  it("ante un importe negativo: mensaje con el CAMPO, sin texto técnico de Zod", () => {
    const r = CreateSupplierInvoiceSchema.safeParse({ ...VALID, importe_no_gravado: -100 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = formatZodIssues(r.error);
      expect(msg).toContain("Importe no gravado");
      expect(msg.toLowerCase()).toContain("no puede ser negativo");
      expect(msg).not.toContain("greater than or equal"); // el técnico crudo ya NO debe aparecer
    }
  });

  it("identifica el renglón de IVA con neto negativo (fila + campo)", () => {
    const r = CreateSupplierInvoiceSchema.safeParse({
      ...VALID,
      vat_lines: [{ alic_iva_id: 5, alicuota_iva: 21, base_neto: -10000, importe_iva: 2100 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = formatZodIssues(r.error);
      expect(msg).toContain("Neto gravado");
      expect(msg).toContain("fila 1");
    }
  });

  it("identifica una percepción con importe negativo", () => {
    const r = CreateSupplierInvoiceSchema.safeParse({
      ...VALID,
      other_taxes: [{ tax_kind: "PERCEPCION_IVA", importe: -50 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = formatZodIssues(r.error);
      expect(msg).toContain("Importe (percepción/tributo)");
      expect(msg.toLowerCase()).toContain("no puede ser negativo");
    }
  });
});
