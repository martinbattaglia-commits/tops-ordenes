import { describe, it, expect } from "vitest";
import { createReaderRegistry } from "./reader-registry";
import { ok } from "../kernel/result";
import type { ReaderPort } from "../kernel/ports";

const reader = (id: string, ext: string): ReaderPort => ({
  id,
  accepts: (f) => f.name.toLowerCase().endsWith(ext),
  read: async () => ok({ headers: [], rows: [], sourceName: "x" }),
});

describe("ReaderRegistry", () => {
  it("resolves by accepts()", () => {
    const r = createReaderRegistry();
    r.register(reader("csv", ".csv"));
    r.register(reader("xlsx", ".xlsx"));
    expect(r.resolve({ name: "leads.csv", type: "text/csv" })?.id).toBe("csv");
    expect(r.resolve({ name: "leads.xlsx", type: "" })?.id).toBe("xlsx");
  });
  it("returns null when nothing accepts", () => {
    const r = createReaderRegistry();
    r.register(reader("csv", ".csv"));
    expect(r.resolve({ name: "leads.xls", type: "" })).toBeNull();
  });
  it("rejects duplicate id", () => {
    const r = createReaderRegistry();
    r.register(reader("csv", ".csv"));
    expect(() => r.register(reader("csv", ".csv"))).toThrow();
  });
});
