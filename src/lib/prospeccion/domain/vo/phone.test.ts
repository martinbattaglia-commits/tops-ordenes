import { describe, it, expect } from "vitest";
import { Phone } from "./phone";

describe("VO Phone", () => {
  it("normaliza a solo dígitos", () => {
    const r = Phone.create("+54 11 4000-9001");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBe("541140009001");
  });
  it("rechaza menos de 8 dígitos y vacío", () => {
    expect(Phone.create("12345").ok).toBe(false);
    expect(Phone.create("").ok).toBe(false);
    expect(Phone.create(null).ok).toBe(false);
  });
  it("igualdad por valor normalizado", () => {
    const a = Phone.create("11-4000-9001");
    const b = Phone.create("1140009001");
    expect(a.ok && b.ok && a.value.equals(b.value)).toBe(true);
  });
});
