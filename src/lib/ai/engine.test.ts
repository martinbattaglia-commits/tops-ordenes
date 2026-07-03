// F5.2-lite · Tests E2E del engine con provider mock y demo mode (sin DB).
// env se evalúa al importar → vi.stubEnv + resetModules + import dinámico.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = "11111111-1111-4111-8111-111111111111";

async function loadEngine() {
  const mod = await import("./engine");
  const guards = await import("./guardrails");
  return { askCopilot: mod.askCopilot, NO_EVIDENCE: guards.NO_EVIDENCE };
}

function baseReq(question: string) {
  return {
    sessionId: SESSION,
    question,
    history: [],
    channel: "page" as const,
  };
}

beforeEach(() => {
  vi.resetModules();
  // Demo mode real: sin Supabase env → isMock() true (no toca DB ni red).
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("AI_PROVIDER", "mock");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("kill-switch AI_ENABLED (fail-closed, D-F5-8)", () => {
  it("sin AI_ENABLED → outcome killed, cero trabajo", async () => {
    vi.stubEnv("AI_ENABLED", "");
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿incidentes abiertos?"));
    expect(res.outcome).toBe("killed");
    expect(res.sources).toEqual([]);
  });
  it("AI_ENABLED=0 → killed (solo '1' habilita)", async () => {
    vi.stubEnv("AI_ENABLED", "0");
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("hola"));
    expect(res.outcome).toBe("killed");
  });
});

describe("flujo completo en demo mode (provider mock + fixtures)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("pregunta del piloto → answered con citas válidas y fuentes", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué incidentes críticos están abiertos?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBeGreaterThan(0);
    expect(res.answer).toMatch(/\[S\d+\]/);
    // El disclaimer de verificación cierra la respuesta compuesta.
    expect(res.answer).toContain("Verificá el detalle en las fuentes");
  });

  it("las 10 preguntas objetivo del piloto responden sin error", async () => {
    const { askCopilot, NO_EVIDENCE } = await loadEngine();
    const preguntas = [
      "¿Qué incidentes críticos están abiertos?",
      "¿Qué tareas están vencidas?",
      "¿Qué pasó hoy en operaciones?",
      "¿Qué clientes tienen más problemas?",
      "¿Qué tareas dependen de José Luis?",
      "Resumime el estado del depósito",
      "¿Qué documentos Compliance están pendientes?",
      "¿Qué workflow está trabado?",
      "¿Qué debería mirar primero mañana?",
      "¿Qué pasó con el incidente INC-2026-0001?",
    ];
    for (const q of preguntas) {
      const res = await askCopilot(baseReq(q));
      expect(["answered", "no_evidence"], q).toContain(res.outcome);
      if (res.outcome === "answered") {
        expect(res.answer, q).toMatch(/\[S\d+\]/);
      } else {
        expect(res.answer, q).toBe(NO_EVIDENCE);
      }
    }
  });

  it("pregunta vacía/mínima → NO_EVIDENCE exacto", async () => {
    const { askCopilot, NO_EVIDENCE } = await loadEngine();
    const res = await askCopilot(baseReq("?"));
    expect(res.outcome).toBe("no_evidence");
    expect(res.answer).toBe(NO_EVIDENCE);
  });

  it("PII embebida en fixtures/citas queda redactada en la respuesta", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué incidentes críticos están abiertos?"));
    // Ningún patrón de CUIT/CBU/email debería sobrevivir en la respuesta.
    expect(res.answer).not.toMatch(/\b\d{2}-\d{8}-\d\b/);
    expect(res.answer).not.toMatch(/\b[\w.+-]+@[\w-]+\.\w{2,}\b/);
  });
});

describe("presupuesto (D-F5-8)", () => {
  it("corta en el límite diario con outcome budget", async () => {
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("AI_LIMIT_REQUESTS_PER_DAY", "2");
    const { askCopilot } = await loadEngine();
    const q = baseReq("¿Qué tareas están vencidas?");
    expect((await askCopilot(q)).outcome).toBe("answered");
    expect((await askCopilot(q)).outcome).toBe("answered");
    const third = await askCopilot(q);
    expect(third.outcome).toBe("budget");
    expect(third.answer).toContain("límite");
  });
});

describe("providers reales sin key → inertes (D-F5-9 / decisión Gemini)", () => {
  it("AI_PROVIDER=gemini sin key → error controlado, cero red", async () => {
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿incidentes?"));
    expect(res.outcome).toBe("error");
    expect(res.sources).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("AI_PROVIDER=anthropic (secundario) sin key → error controlado", async () => {
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("AI_PROVIDER", "anthropic");
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿incidentes?"));
    expect(res.outcome).toBe("error");
    expect(res.sources).toEqual([]);
  });
});
