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
  const today = new Date("2026-06-24T12:00:00");
  it("forecast/pipeline solo sobre vivos; concreción ponderada, bandas y vencidas", () => {
    const k = computeKpis([
      ed({ amount: 1000, effective_probability: 50, status: "open", expected_close: "2026-06-01" }), // vencido, banda alta
      ed({ amount: 3000, effective_probability: 10, status: "open" }),                                // banda baja, no vencido
      ed({ amount: 2000, effective_probability: 80, status: "expired" }),                             // excluido (vivos = open/other)
      ed({ amount: 5000, effective_probability: 100, status: "won" }),                                // excluido
    ], today);
    expect(k.count).toBe(4);
    expect(k.activePipeline).toBe(4000);     // open: 1000+3000
    expect(k.forecast).toBe(800);             // 1000*0.5 + 3000*0.1
    expect(k.wonAmount).toBe(5000);
    expect(k.weightedConcretion).toBe(20);    // 800/4000*100, ponderada por monto
    expect(k.overdueCount).toBe(1);           // solo el de fecha 2026-06-01
    expect(k.overdueAmount).toBe(1000);
    const alta = k.bands.find((b) => b.key === "alta")!;
    const baja = k.bands.find((b) => b.key === "baja")!;
    expect(alta.count).toBe(1); expect(alta.amount).toBe(1000); // prob 50
    expect(baja.count).toBe(1); expect(baja.amount).toBe(3000); // prob 10
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
