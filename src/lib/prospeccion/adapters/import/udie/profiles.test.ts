import { describe, it, expect } from "vitest";
import { makeProspectMapper, PROSPECT_PROFILES, prospectDetectors, profileFor } from "./profiles";
import { asDetectedFormat, type RawTable } from "@/lib/udie/kernel/types";
import { createDetectorRegistry } from "@/lib/udie/core/detector-registry";

const table = (headers: string[]): RawTable => ({ headers, rows: [], sourceName: "x.csv" });

describe("prospect profiles", () => {
  it("maps LinkedIn-style headers with spaces and combines first+last name", () => {
    const m = makeProspectMapper(asDetectedFormat("LinkedIn Sales Navigator"));
    const row = m.map({ "Company Name": "ACME", "Email": "a@b.co", "First Name": "Ana", "Last Name": "Gómez", "LinkedIn Url": "X" }, asDetectedFormat("LinkedIn Sales Navigator"));
    expect(row.company_name).toBe("ACME");
    expect(row.email).toBe("a@b.co");
    expect(row.full_name).toBe("Ana Gómez");
    expect(row.linkedin_url).toBe("X");
    expect((row.raw as Record<string, unknown>)._detected_format).toBe("LinkedIn Sales Navigator");
  });
  it("detector picks evaboot over generic on evaboot headers", () => {
    const reg = createDetectorRegistry();
    prospectDetectors.forEach((d) => reg.register(d));
    const hit = reg.detect(table(["Company", "Title", "Email", "LinkedIn Url", "Evaboot Cleaned Company Name"]));
    expect(hit?.format).toBe("Evaboot");
  });
  it("falls back to Generic CSV", () => {
    const reg = createDetectorRegistry();
    prospectDetectors.forEach((d) => reg.register(d));
    const hit = reg.detect(table(["foo", "bar", "email"]));
    expect(hit?.format).toBe("Generic CSV");
  });
  it("every profile maps to a valid source slug", () => {
    for (const p of PROSPECT_PROFILES) expect(["linkedin_sales_navigator", "csv"]).toContain(p.sourceSlug);
    expect(profileFor(asDetectedFormat("Apollo")).sourceSlug).toBe("csv");
  });
});
