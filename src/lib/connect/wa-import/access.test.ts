import { describe, expect, it } from "vitest";
import { canAccessWaCommercialImport } from "./access";

describe("WhatsApp Comercial · acceso y descubrimiento", () => {
  it("mantiene el acceso limitado al rol admin", () => {
    expect(canAccessWaCommercialImport("admin")).toBe(true);
    expect(canAccessWaCommercialImport("presidente")).toBe(false);
    expect(canAccessWaCommercialImport("operaciones")).toBe(false);
    expect(canAccessWaCommercialImport(null)).toBe(false);
    expect(canAccessWaCommercialImport(undefined)).toBe(false);
  });
});
