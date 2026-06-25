import { describe, it, expect } from "vitest";
import { Cuit } from "./cuit";

describe("VO Cuit", () => {
  it("acepta un CUIT con dígito verificador válido (normaliza guiones)", () => {
    const r = Cuit.create("20-12345678-6");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBe("20123456786");
  });

  it("rechaza dígito verificador incorrecto", () => {
    const r = Cuit.create("20123456780");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_CUIT");
  });

  it("rechaza longitud inválida y placeholders", () => {
    expect(Cuit.create("123").ok).toBe(false);
    expect(Cuit.create("00000000000").ok).toBe(false);
    expect(Cuit.create("").ok).toBe(false);
    expect(Cuit.create(null).ok).toBe(false);
  });
});
