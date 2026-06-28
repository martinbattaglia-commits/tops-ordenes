import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runProspectImportPreview, slugForDetectedFormat } from "./prospect-import-engine";

vi.mock("../../driving/import-actions", () => ({
  importProspectsAction: vi.fn(async () => ({ ok: true, message: "ok", inserted: 1, duplicates: 0, rejected: 0 })),
}));

const fx = (name: string, type = "text/csv") => {
  const buf = readFileSync(resolve(process.cwd(), "tests/fixtures/import", name));
  return new File([buf], name, { type });
};

const cases: Array<[string, string, string]> = [
  ["linkedin.csv", "LinkedIn Sales Navigator", "linkedin_sales_navigator"],
  ["evaboot.csv", "Evaboot", "csv"],
  ["apollo.csv", "Apollo", "csv"],
  ["wiza.csv", "Wiza", "csv"],
  ["phantombuster.csv", "Phantombuster", "csv"],
  ["clientify.csv", "Clientify", "csv"],
  ["generic.csv", "Generic CSV", "csv"],
];

describe("prospect import engine (integration, real fixtures)", () => {
  it.each(cases)("detects %s as %s and maps rows", async (file, fmt, slug) => {
    const r = await runProspectImportPreview(fx(file));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stats.detectedFormat).toBe(fmt);
    expect(slugForDetectedFormat(r.value.stats.detectedFormat)).toBe(slug);
    expect(r.value.rows.length).toBeGreaterThan(0);
    expect(r.value.rows.every((row) => (row.row.raw as Record<string, unknown>)._detected_format === fmt)).toBe(true);
  });

  it("parses xlsx via exceljs reader", async () => {
    const r = await runProspectImportPreview(
      fx("sample.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rows[0].row.email).toBe("laura@acme.test");
  });

  it("linkedin: row without email is still kept (linkedin_url is identity)", async () => {
    const r = await runProspectImportPreview(fx("linkedin.csv"));
    if (r.ok) expect(r.value.rows.some((row) => row.valid && !row.row.email)).toBe(true);
  });

  it("linkedin: unmappedHeaders does NOT contain first name or last name (Fix #2)", async () => {
    const r = await runProspectImportPreview(fx("linkedin.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const unmapped = r.value.stats.unmappedHeaders.map((h: string) => h.toLowerCase());
    expect(unmapped).not.toContain("first name");
    expect(unmapped).not.toContain("last name");
  });
});
