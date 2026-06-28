import { describe, it, expect } from "vitest";
import { defaultNormalizer } from "./default-normalizer";
import { asDetectedFormat, type RawTable } from "../kernel/types";

describe("defaultNormalizer", () => {
  it("strips BOM and trims headers and cells", () => {
    const t: RawTable = {
      headers: ["﻿Company Name", " Email "],
      rows: [{ "﻿Company Name": "  ACME ", " Email ": " a@b.co " }],
      sourceName: "x.csv",
    };
    const out = defaultNormalizer.normalize(t, asDetectedFormat("generic"));
    expect(out.headers).toEqual(["Company Name", "Email"]);
    expect(out.rows[0]).toEqual({ "Company Name": "ACME", "Email": "a@b.co" });
  });
});
