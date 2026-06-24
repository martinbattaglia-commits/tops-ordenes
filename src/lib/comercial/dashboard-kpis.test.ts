import { describe, it, expect } from "vitest";
import { computeKpis, dealAlerts, type EnrichedDeal } from "./dashboard-kpis";

function ed(p: Partial<EnrichedDeal>): EnrichedDeal {
  return {
    deal_id: 1, title: "t", company_name: null, contact_name: null, amount: 0,
    currency: "ARS", pipeline: "ANMAT", pipeline_id: 10, stage: "s", status: "open",
    owner_name: null, expected_close: null, modified_src: null, href: "",
    effective_probability: 0, overlay_horizonte: null, overlay_observaciones: null, ...p,
  };
}

describe("computeKpis", () => {
  it("forecast solo sobre activos no-expired; pipeline vivo excluye won/lost/expired", () => {
    const k = computeKpis([
      ed({ amount: 1000, effective_probability: 50, status: "open" }),
      ed({ amount: 2000, effective_probability: 80, status: "expired" }),
      ed({ amount: 5000, effective_probability: 100, status: "won" }),
    ]);
    expect(k.count).toBe(3);
    expect(k.activePipeline).toBe(1000);  // solo open
    expect(k.forecast).toBe(500);          // 1000*0.5
    expect(k.wonAmount).toBe(5000);
  });
});

describe("dealAlerts", () => {
  const today = new Date("2026-06-24T12:00:00");
  it("marca cierre vencido y deal estancado", () => {
    const alerts = dealAlerts(
      ed({ status: "open", expected_close: "2026-06-01", modified_src: "2026-05-01T00:00:00Z" }),
      today
    ).map((a) => a.kind);
    expect(alerts).toContain("overdue");
    expect(alerts).toContain("stale");
  });
  it("no alerta deals ganados", () => {
    expect(dealAlerts(ed({ status: "won", expected_close: "2026-06-01" }), today)).toHaveLength(0);
  });
});
