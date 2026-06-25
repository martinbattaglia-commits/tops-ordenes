import { describe, it, expect } from "vitest";
import { makeProspectId } from "./prospect-id";

describe("VO ProspectId", () => {
  it("acepta un UUID válido", () => {
    const r = makeProspectId("11111111-1111-4111-8111-111111111111");
    expect(r.ok).toBe(true);
  });
  it("rechaza no-UUID", () => {
    expect(makeProspectId("123").ok).toBe(false);
    expect(makeProspectId("").ok).toBe(false);
    const r = makeProspectId("not-a-uuid");
    if (!r.ok) expect(r.error.code).toBe("INVALID_PROSPECT_ID");
  });
});
