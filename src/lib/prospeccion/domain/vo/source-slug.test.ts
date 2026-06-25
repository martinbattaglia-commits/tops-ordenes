import { describe, it, expect } from "vitest";
import { SourceSlug, SOURCE_SLUGS } from "./source-slug";

describe("VO SourceSlug", () => {
  it("acepta cada slug del catálogo", () => {
    for (const s of SOURCE_SLUGS) {
      const r = SourceSlug.create(s);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.value).toBe(s);
    }
  });
  it("rechaza slugs desconocidos y vacío", () => {
    expect(SourceSlug.create("instagram").ok).toBe(false);
    expect(SourceSlug.create("").ok).toBe(false);
    expect(SourceSlug.create(null).ok).toBe(false);
    const r = SourceSlug.create("x");
    if (!r.ok) expect(r.error.code).toBe("INVALID_SOURCE");
  });
});
