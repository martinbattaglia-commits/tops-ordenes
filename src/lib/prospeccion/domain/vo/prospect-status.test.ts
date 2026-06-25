import { describe, it, expect } from "vitest";
import { ProspectStatus, PROSPECT_STATUSES, F0_STATUSES } from "./prospect-status";

describe("VO ProspectStatus", () => {
  it("acepta los 10 estados del enum SQL", () => {
    expect(PROSPECT_STATUSES.length).toBe(10);
    for (const s of PROSPECT_STATUSES) expect(ProspectStatus.create(s).ok).toBe(true);
  });
  it("F0 sólo produce raw/imported/duplicado", () => {
    expect(F0_STATUSES).toEqual(["raw", "imported", "duplicado"]);
  });
  it("rechaza estados inválidos", () => {
    expect(ProspectStatus.create("approved").ok).toBe(false); // inglés de dominio, no enum SQL
    expect(ProspectStatus.create("").ok).toBe(false);
  });
});
