import { describe, expect, it, vi, beforeEach } from "vitest";

// LINK-WA-002 · FASE 2 E1 REMEDIACIÓN — pruebas del EMBUDO ÚNICO.
// Se ejercita `engine.runStructuredAnalysis` de verdad, mockeando sólo las
// fronteras (gate, budget, audit, supabase) para poder forzar cada camino.

vi.mock("server-only", () => ({}));

const checkGate = vi.fn();
const checkBudget = vi.fn();
const checkMonthlyBudget = vi.fn();
const logInteraction = vi.fn(
  async (_supabase: unknown, _payload: Record<string, unknown>) => "msg-id",
);
const getProvider = vi.fn();

vi.mock("../gate", () => ({
  checkGate: (...a: unknown[]) => checkGate(...a),
  isMock: () => false,
  KILLED_MESSAGE: "El Copilot está desactivado en este entorno (AI_ENABLED).",
  DENIED_MESSAGE: "El Copilot está en piloto cerrado.",
}));
vi.mock("../budget", () => ({
  checkBudget: (...a: unknown[]) => checkBudget(...a),
  checkMonthlyBudget: (...a: unknown[]) => checkMonthlyBudget(...a),
}));
vi.mock("../audit", () => ({
  logInteraction: (sb: unknown, p: Record<string, unknown>) => logInteraction(sb, p),
  // El camino estructurado usa la variante con resultado EXPLÍCITO: la auditoría
  // económica es fail-closed, así que el engine necesita saber si persistió.
  logInteractionResult: async (sb: unknown, p: Record<string, unknown>) => {
    await logInteraction(sb, p);
    return { ok: true, messageId: "msg-id", persisted: true };
  },
  sha256: (s: string) => s,
}));
vi.mock("../provider", () => ({ getProvider: () => getProvider() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => null,
  createAdminClient: () => null,
}));
vi.mock("@/lib/env", () => ({
  env: {
    ai: { provider: "mock", enabled: true, limits: { maxTurnsPerSession: 5, toolRoundsPerRequest: 2 } },
    app: {},
  },
}));

import { runStructuredAnalysis } from "../engine";

const MOCK_PROVIDER = { name: "mock", model: "mock-1", plan: vi.fn() };
// El engine exige un UUID por corrida: es la clave que une ai_analysis_runs con
// ai_messages. Un string cualquiera lo rechaza el RPC (fue el defecto real).
const RUN_ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  checkGate.mockResolvedValue({ ok: true, userId: "u1", demo: false });
  checkMonthlyBudget.mockResolvedValue({ allowed: true });
  checkBudget.mockResolvedValue({ allowed: true });
  getProvider.mockReturnValue(MOCK_PROVIDER);
});

describe("E1 · el mock ATRAVIESA engine.ts (embudo único)", () => {
  it("ejecuta el generador y devuelve la salida cruda con provider del entorno", async () => {
    const generate = vi.fn(async () => ({ raw: '{"ok":true}' }));
    const r = await runStructuredAnalysis({ runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.raw).toBe('{"ok":true}');
      expect(r.provider).toBe("mock");
      expect(r.costUsd).toBe(0); // costo cero confirmado
    }
    // El provider lo resuelve el ENGINE, no el caller.
    expect(getProvider).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith("P", MOCK_PROVIDER);
  });

  it("los guards corren en orden: gate → mensual → diario → provider", async () => {
    const order: string[] = [];
    checkGate.mockImplementation(async () => { order.push("gate"); return { ok: true, userId: "u1", demo: false }; });
    checkMonthlyBudget.mockImplementation(async () => { order.push("mensual"); return { allowed: true }; });
    checkBudget.mockImplementation(async () => { order.push("diario"); return { allowed: true }; });
    getProvider.mockImplementation(() => { order.push("provider"); return MOCK_PROVIDER; });
    await runStructuredAnalysis({ runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate: async () => ({ raw: "{}" }) });
    expect(order).toEqual(["gate", "mensual", "diario", "provider"]);
  });
});

describe("E1 · kill-switch bloquea ANTES del provider", () => {
  it("AI_ENABLED apagado ⇒ killed, sin tocar provider ni generador", async () => {
    checkGate.mockResolvedValue({ ok: false, outcome: "killed", message: "desactivado" });
    const generate = vi.fn(async () => ({ raw: "{}" }));
    const r = await runStructuredAnalysis({ runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate });
    expect(r).toMatchObject({ ok: false, outcome: "killed" });
    expect(generate).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();
    // El corte queda auditado (D-F5-7).
    expect(logInteraction).toHaveBeenCalledTimes(1);
    expect(logInteraction.mock.calls[0][1]).toMatchObject({ outcome: "killed" });
  });
});

describe("E1 · usuario sin permiso", () => {
  it("fuera del piloto ⇒ denied, auditado, sin provider", async () => {
    checkGate.mockResolvedValue({ ok: false, outcome: "denied", message: "piloto cerrado" });
    const generate = vi.fn(async () => ({ raw: "{}" }));
    const r = await runStructuredAnalysis({ runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate });
    expect(r).toMatchObject({ ok: false, outcome: "denied" });
    expect(generate).not.toHaveBeenCalled();
    expect(logInteraction.mock.calls[0][1]).toMatchObject({ outcome: "denied" });
  });
});

describe("E1 · presupuesto", () => {
  it("tope MENSUAL agotado ⇒ budget, sin generar", async () => {
    checkMonthlyBudget.mockResolvedValue({ allowed: false, reason: "El presupuesto mensual de IA (USD 20) está agotado." });
    const generate = vi.fn(async () => ({ raw: "{}" }));
    const r = await runStructuredAnalysis({ runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate });
    expect(r).toMatchObject({ ok: false, outcome: "budget" });
    expect(r.ok === false && r.message).toContain("mensual");
    expect(generate).not.toHaveBeenCalled();
    expect(logInteraction.mock.calls[0][1]).toMatchObject({ outcome: "budget" });
  });

  it("tope DIARIO agotado ⇒ budget, sin generar", async () => {
    checkBudget.mockResolvedValue({ allowed: false, reason: "Presupuesto diario agotado." });
    const generate = vi.fn(async () => ({ raw: "{}" }));
    const r = await runStructuredAnalysis({ runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate });
    expect(r).toMatchObject({ ok: false, outcome: "budget" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("el diario NO se consulta si el mensual ya cortó (orden correcto)", async () => {
    checkMonthlyBudget.mockResolvedValue({ allowed: false, reason: "mensual agotado" });
    await runStructuredAnalysis({ runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate: async () => ({ raw: "{}" }) });
    expect(checkBudget).not.toHaveBeenCalled();
  });
});

describe("E1 · provider caído", () => {
  it("excepción del generador ⇒ error GOBERNADO (no excepción hacia afuera)", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => { throw new Error("ECONNRESET del provider"); },
    });
    expect(r).toMatchObject({ ok: false, outcome: "error" });
    expect(r.ok === false && r.message).not.toContain("ECONNRESET"); // detalle técnico no se filtra al usuario
    // …pero SÍ queda en la auditoría.
    expect(logInteraction.mock.calls[0][1]).toMatchObject({
      outcome: "error", errorDetail: "ECONNRESET del provider",
    });
  });

  it("provider distinto de mock ⇒ el generador de E1 lo rechaza y el engine lo gobierna", async () => {
    getProvider.mockReturnValue({ name: "anthropic", model: "claude", plan: vi.fn() });
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async (_p, provider) => {
        if (provider.name !== "mock") throw new Error("E1 sólo admite provider mock");
        return { raw: "{}" };
      },
    });
    expect(r).toMatchObject({ ok: false, outcome: "error" });
  });
});

describe("E1 · auditoría de la ejecución mock", () => {
  it("registra provider, modelo, costo cero y outcome answered", async () => {
    await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      entityContext: "connect_conversation:abc",
      generate: async () => ({ raw: '{"clasificacion":"x"}' }),
    });
    expect(logInteraction).toHaveBeenCalledTimes(1);
    const payload = logInteraction.mock.calls[0][1];
    expect(payload).toMatchObject({
      outcome: "answered", provider: "mock", model: "mock-1",
      costEstimate: 0, entityContext: "connect_conversation:abc",
    });
    expect(payload.toolsUsed).toEqual([]);
  });

  it("la salida auditada pasa por redacción de PII", async () => {
    await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => ({ raw: "CUIT 30-71234567-8 y mail juan@empresa.com" }),
    });
    const answer = String((logInteraction.mock.calls[0][1]).answer);
    expect(answer).not.toContain("30-71234567-8");
    expect(answer).not.toContain("juan@empresa.com");
  });
});

describe("E1 · analyze.ts pasa por el engine (no hay camino paralelo)", () => {
  it("importa runStructuredAnalysis y NO getProvider", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./analyze.ts", import.meta.url).pathname, "utf8");
    expect(src).toContain("runStructuredAnalysis");
    const imports = src.split("\n").filter((l) => /^\s*import\s/.test(l)).join("\n");
    expect(imports).toContain("../engine");
    expect(imports).not.toContain("getProvider");
    expect(imports).not.toContain("./provider");
    // Código SIN comentarios: los comentarios nombran lo prohibido justamente para
    // documentar que no se usa (garantías del encabezado).
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(code).not.toContain("getProvider");
    expect(code).not.toMatch(/provider\.plan\s*\(/);
  });
});
