import { describe, it, expect } from "vitest";
import {
  hasSuspiciousAmount, calculateCommercialScore, getOpportunityPriority,
  getOpportunityAlert, getSuggestedAction, isLiveOpportunity,
  normalizeScore, getSemaforoColor, getSemaforoLabel,
} from "./commercial-score";
import type { EnrichedDeal } from "./dashboard-kpis";

function ed(p: Partial<EnrichedDeal>): EnrichedDeal {
  return {
    deal_id: 1, title: "t", company_name: null, contact_name: null, amount: 0,
    currency: "ARS", pipeline: "ANMAT", pipeline_id: 10, stage: "Propuesta enviada", status: "open",
    owner_name: null, expected_close: null, actual_close: null, modified_src: "2026-06-20T00:00:00Z", href: "",
    effective_probability: 0, overlay_horizonte: null, overlay_observaciones: null, deal_source: null, ...p,
  };
}
const today = new Date("2026-06-24T12:00:00");

describe("commercial-score", () => {
  it("flags importe sospechoso y lo hunde en el score", () => {
    const sus = ed({ amount: 1, effective_probability: 80, overlay_horizonte: "Esta semana" });
    const real = ed({ amount: 1, effective_probability: 80, overlay_horizonte: "Esta semana", deal_id: 2 });
    real.amount = 5_000_000;
    expect(hasSuspiciousAmount(sus)).toBe(true);
    expect(hasSuspiciousAmount(real)).toBe(false);
    expect(calculateCommercialScore(real, today)).toBeGreaterThan(calculateCommercialScore(sus, today));
  });

  it("ordena por importe×prob×horizonte×etapa; vencida penaliza; won/lost = 0", () => {
    const hot = ed({ amount: 5_000_000, effective_probability: 80, overlay_horizonte: "Esta semana", stage: "Alta probabilidad" });
    const cold = ed({ amount: 5_000_000, effective_probability: 80, overlay_horizonte: "Esta semana", stage: "Alta probabilidad", expected_close: "2026-01-01", deal_id: 2 });
    expect(calculateCommercialScore(hot, today)).toBeGreaterThan(calculateCommercialScore(cold, today)); // vencida penaliza
    expect(calculateCommercialScore(ed({ status: "won", amount: 9_000_000, effective_probability: 100 }), today)).toBe(0);
    expect(isLiveOpportunity(ed({ status: "lost" }))).toBe(false);
  });

  it("ubica cuadrantes de prioridad (split de importe en 2.000.000)", () => {
    const split = 2_000_000;
    expect(getOpportunityPriority(ed({ amount: 5_000_000, effective_probability: 70 }), split)).toBe("alta_prioridad");
    expect(getOpportunityPriority(ed({ amount: 500_000, effective_probability: 70 }), split)).toBe("quick_win");
    expect(getOpportunityPriority(ed({ amount: 5_000_000, effective_probability: 20 }), split)).toBe("a_trabajar");
    expect(getOpportunityPriority(ed({ amount: 500_000, effective_probability: 20 }), split)).toBe("baja_prioridad");
  });

  it("genera alerta y acción según reglas", () => {
    expect(getOpportunityAlert(ed({ amount: 1, effective_probability: 30 }), today)?.severity).toBe("critica");
    expect(getOpportunityAlert(ed({ amount: 5_000_000, effective_probability: 30, expected_close: "2026-01-01" }), today)?.severity).toBe("critica");
    expect(getSuggestedAction(ed({ amount: 1 }), today)).toMatch(/importe/i);
    expect(getSuggestedAction(ed({ amount: 5_000_000, effective_probability: 60, overlay_horizonte: null }), today)).toMatch(/horizonte/i);
  });
});

describe("normalizeScore", () => {
  it("maps percentile rank to 0-100 range", () => {
    const scores = [0, 50, 100];
    expect(normalizeScore(scores, 0)).toBeGreaterThanOrEqual(0);
    expect(normalizeScore(scores, 100)).toBeLessThanOrEqual(100);
    expect(normalizeScore(scores, 50)).toBeGreaterThan(0);
    expect(normalizeScore(scores, 50)).toBeLessThan(100);
  });

  it("returns 0 for empty scores array", () => {
    expect(normalizeScore([], 50)).toBe(0);
  });

  it("returns 100 when all scores are the same", () => {
    expect(normalizeScore([42, 42, 42], 42)).toBe(100);
  });
});

describe("getSemaforoColor", () => {
  it("boundary tests", () => {
    expect(getSemaforoColor(34)).toBe("red");
    expect(getSemaforoColor(35)).toBe("yellow");
    expect(getSemaforoColor(64)).toBe("yellow");
    expect(getSemaforoColor(65)).toBe("green");
  });

  it("getSemaforoLabel returns correct labels", () => {
    expect(getSemaforoLabel("green")).toBe("Prioritaria");
    expect(getSemaforoLabel("yellow")).toBe("En seguimiento");
    expect(getSemaforoLabel("red")).toBe("En riesgo");
  });
});
