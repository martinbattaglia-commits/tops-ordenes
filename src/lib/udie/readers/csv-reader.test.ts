import { describe, it, expect } from "vitest";
import { csvReader } from "./csv-reader";

const blob = (s: string) => new Blob([s], { type: "text/csv" });

describe("csvReader", () => {
  it("accepts .csv by name or mime", () => {
    expect(csvReader.accepts({ name: "x.csv", type: "" })).toBe(true);
    expect(csvReader.accepts({ name: "x", type: "text/csv" })).toBe(true);
    expect(csvReader.accepts({ name: "x.xlsx", type: "" })).toBe(false);
  });
  it("parses headers and rows, BOM, semicolon, quoted commas, embedded newlines", async () => {
    const csv = "﻿Company;Note\n\"ACME, SA\";\"line1\nline2\"\n";
    const r = await csvReader.read(blob(csv));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.headers).toEqual(["Company", "Note"]);
    expect(r.value.rows[0]["Company"]).toBe("ACME, SA");
    expect(r.value.rows[0]["Note"]).toBe("line1\nline2");
  });
});
