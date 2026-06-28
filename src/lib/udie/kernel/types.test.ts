import { describe, it, expect } from "vitest";
import { ok, err, domainError } from "./result";

describe("udie kernel result", () => {
  it("ok wraps a value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });
  it("err wraps a domain error", () => {
    const r = err(domainError("X", "boom"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("boom");
  });
});
