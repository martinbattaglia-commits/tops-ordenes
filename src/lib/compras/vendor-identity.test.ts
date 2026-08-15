import { describe, expect, it } from "vitest";
import {
  assertCanonicalVendor,
  VendorIdentityError,
  type CanonicalVendor,
} from "./vendor-identity";

const canonical: CanonicalVendor = {
  id: "11111111-1111-4111-8111-111111111111",
  razon: "Distribuidora Ávila S.A.",
  cuit: "30-70000001-5",
  domicilio: "Domicilio maestro",
  telefono: "1111",
  contacto: "Contacto maestro",
  email: "canonico@proveedor.test",
  categoria: "Insumos",
  cond_pago: "30 días",
  active: true,
};

function input(overrides: Partial<{ id: string; razon: string; cuit: string }> = {}) {
  return { id: canonical.id, razon: canonical.razon, cuit: canonical.cuit, ...overrides };
}

describe("frontera canónica de proveedor OC", () => {
  it("devuelve exclusivamente la ficha maestra, nunca contacto del navegador", () => {
    const result = assertCanonicalVendor(input(), canonical);
    expect(result).toBe(canonical);
    expect(result.email).toBe("canonico@proveedor.test");
  });

  it("tolera sólo diferencias cosméticas de razón y CUIT", () => {
    expect(assertCanonicalVendor(input({ razon: " distribuidora avila s.a. ", cuit: "30700000015" }), canonical)).toBe(canonical);
  });

  for (const [label, row, payload, code] of [
    ["inexistente", null, input(), "VENDOR_NOT_FOUND"],
    ["inactivo", { ...canonical, active: false }, input(), "VENDOR_INACTIVE"],
    ["CUIT falsificado", canonical, input({ cuit: "30-71181219-5" }), "VENDOR_CUIT_MISMATCH"],
    ["razón falsificada", canonical, input({ razon: "Otro proveedor" }), "VENDOR_NAME_MISMATCH"],
  ] as const) {
    it(`rechaza proveedor ${label}`, () => {
      expect(() => assertCanonicalVendor(payload, row)).toThrowError(VendorIdentityError);
      try {
        assertCanonicalVendor(payload, row);
      } catch (error) {
        expect((error as VendorIdentityError).code).toBe(code);
      }
    });
  }
});
