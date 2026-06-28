import { describe, it, expect } from "vitest";
import { prospectDedupKeys } from "./prospect-dedup-keys";
import { prospectValidator } from "./prospect-validator";

describe("prospect domain ports", () => {
  it("dedup keys lowercase email and pick primary (cuit first)", () => {
    const k = prospectDedupKeys.keysOf({ cuit: "30-70111223-4", email: "A@B.CO", linkedin_url: "x" });
    expect(k.email).toBe("a@b.co");
    expect(prospectDedupKeys.primaryKey({ cuit: "30701112234", email: "a@b.co" })).toBe("30701112234");
  });
  it("validator rejects a row with no identity", () => {
    const out = prospectValidator.validate({ company_name: "ACME" });
    expect(out.valid).toBe(false);
    expect(out.diagnostics[0].message).toMatch(/identidad/i);
  });
  it("validator accepts a row with a valid email", () => {
    const out = prospectValidator.validate({ email: "laura@acme.test" });
    expect(out.valid).toBe(true);
  });
  it("validator rejects an invalid email", () => {
    const out = prospectValidator.validate({ email: "no-arroba" });
    expect(out.valid).toBe(false);
  });
});
