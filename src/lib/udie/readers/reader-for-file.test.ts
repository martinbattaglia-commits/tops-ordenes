import { describe, it, expect } from "vitest";
import { resolveReader } from "./reader-for-file";
import { csvReader } from "./csv-reader";
import { xlsxReader } from "./xlsx-reader";
import { createReaderRegistry } from "../core/reader-registry";

function reg() {
  const r = createReaderRegistry();
  r.register(csvReader);
  r.register(xlsxReader);
  return r;
}

describe("resolveReader", () => {
  it("resolves csv and xlsx", () => {
    const r = reg();
    expect(resolveReader(r, { name: "x.csv", type: "" }).ok).toBe(true);
    expect(resolveReader(r, { name: "x.xlsx", type: "" }).ok).toBe(true);
  });
  it("rejects legacy .xls with a clear error", () => {
    const out = resolveReader(reg(), { name: "x.xls", type: "" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("UNSUPPORTED_FORMAT");
  });
});
