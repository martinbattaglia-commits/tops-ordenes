// LINK-WA-002 · E1.1 — remediación H1 de la revisión adversarial independiente.
//
// Dirección autorizó: Gemini FLASH · 20 análisis/día · USD 15/mes.
// Los defaults del código estaban en Pro / 40 / USD 100 — es decir, activar la
// IA sin tocar nada habría corrido ~4× más caro y con el doble de cupo.
// Estos tests fijan los defaults autorizados. Si alguien los sube, se rompe acá
// y no en la factura.
//
// ⚠️ El ENTORNO pisa los defaults: que estos tests pasen NO prueba que
// producción esté en 15/20/flash. Eso se verifica en la ventana de activación.

import { describe, expect, it, vi, beforeEach } from "vitest";

async function loadEnv() {
  vi.resetModules();
  return (await import("@/lib/env")).env;
}

beforeEach(() => vi.unstubAllEnvs());

describe("H1 · los defaults en código son los AUTORIZADOS por Dirección", () => {
  it("modelo default de Gemini = flash (no pro)", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_MODEL", "");
    expect((await loadEnv()).ai.model).toBe("gemini-2.5-flash");
  });

  it("cupo diario default = 20 análisis", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "");
    vi.stubEnv("AI_LIMIT_REQUESTS_PER_DAY", "");
    expect((await loadEnv()).ai.limits.requestsPerDay).toBe(20);
  });

  it("tope mensual default = USD 15", async () => {
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "");
    expect((await loadEnv()).ai.limits.monthlyBudgetUsd).toBe(15);
  });

  it("el entorno puede pisarlos: el default es piso de seguridad, no candado", async () => {
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "15");
    expect((await loadEnv()).ai.limits.monthlyBudgetUsd).toBe(15);
  });
});
