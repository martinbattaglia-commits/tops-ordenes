import { describe, it, expect } from "vitest";
import { ProspectFactory } from "./prospect";
import { SourceSlug } from "./vo/source-slug";
import { makeProspectId } from "./vo/prospect-id";

const ID = "11111111-1111-4111-8111-111111111111";
const src = () => {
  const r = SourceSlug.create("csv");
  if (!r.ok) throw new Error("source");
  return r.value;
};
const id = () => {
  const r = makeProspectId(ID);
  if (!r.ok) throw new Error("id");
  return r.value;
};

describe("Prospect (AR) · fromImportRow", () => {
  it("construye un prospecto válido y normaliza (status=raw)", () => {
    const r = ProspectFactory.fromImportRow(id(), src(), {
      company_name: "  ACME  ",
      email: "Laura@ACME.test",
      cuit: "20-12345678-6",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const s = r.value.toSnapshot();
      expect(s.status).toBe("raw");
      expect(s.email).toBe("laura@acme.test");
      expect(s.cuit).toBe("20123456786");
      expect(s.company_name).toBe("ACME");
      expect(s.source).toBe("csv");
    }
  });

  it("rechaza fila SIN clave de identidad (MISSING_IDENTITY)", () => {
    const r = ProspectFactory.fromImportRow(id(), src(), { company_name: "Solo Empresa" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("MISSING_IDENTITY");
  });

  it("propaga error de VO inválido (email)", () => {
    const r = ProspectFactory.fromImportRow(id(), src(), { email: "roto" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_EMAIL");
  });

  it("acepta identidad por linkedin solo", () => {
    const r = ProspectFactory.fromImportRow(id(), src(), { linkedin_url: "https://www.LinkedIn.com/in/x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.toSnapshot().linkedin_url).toBe("https://www.linkedin.com/in/x");
  });
});
