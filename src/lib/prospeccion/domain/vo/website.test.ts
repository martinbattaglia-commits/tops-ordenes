import { describe, it, expect } from "vitest";
import { Website } from "./website";

describe("VO Website", () => {
  it("normaliza: quita esquema, www y path/query → host lowercase", () => {
    const r = Website.create("HTTPS://www.ACME.test/path?x=1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBe("acme.test");
  });
  it("acepta subdominios y host simple", () => {
    expect(Website.create("app.acme.test").ok).toBe(true);
    expect(Website.create("acme.com").ok).toBe(true);
  });
  it("rechaza host sin TLD y vacío", () => {
    expect(Website.create("acme").ok).toBe(false);
    expect(Website.create("").ok).toBe(false);
    expect(Website.create(null).ok).toBe(false);
  });
});
