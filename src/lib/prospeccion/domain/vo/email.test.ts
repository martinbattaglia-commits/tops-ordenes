import { describe, it, expect } from "vitest";
import { Email } from "./email";

describe("VO Email", () => {
  it("normaliza a minúsculas y recorta", () => {
    const r = Email.create("  Laura@ACME.test ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBe("laura@acme.test");
  });

  it("rechaza emails inválidos y vacíos", () => {
    expect(Email.create("no-arroba").ok).toBe(false);
    expect(Email.create("a@b").ok).toBe(false);
    expect(Email.create("").ok).toBe(false);
    expect(Email.create(undefined).ok).toBe(false);
  });

  it("igualdad por valor normalizado", () => {
    const a = Email.create("X@y.com");
    const b = Email.create("x@Y.com");
    expect(a.ok && b.ok && a.value.equals(b.value)).toBe(true);
  });
});
