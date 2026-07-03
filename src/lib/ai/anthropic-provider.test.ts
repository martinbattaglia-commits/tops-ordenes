// F5.2-lite · Tests del AnthropicProvider — SIN RED: fetch global mockeado.
// Verifica: fail-closed sin key (cero llamadas), request bien formado para
// Opus 4.7+ (sin sampling params, thinking adaptativo, tools del catálogo),
// parseo de tool_use/final/refusal, y cálculo de costo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_REQ = {
  system: "system de prueba",
  question: "¿Qué incidentes críticos están abiertos?",
  history: [],
  chunks: [],
  round: 1,
  maxRounds: 4,
};

function mockFetchOnce(payload: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function loadProvider() {
  const mod = await import("./providers/anthropic");
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fail-closed sin API key (D-F5-9)", () => {
  it("plan() lanza ANTES de tocar la red", async () => {
    vi.stubEnv("AI_ANTHROPIC_API_KEY", "");
    const fetchSpy = mockFetchOnce({});
    const { AnthropicProvider, AnthropicProviderDisabledError } = await loadProvider();
    const p = new AnthropicProvider();
    await expect(p.plan(SESSION_REQ)).rejects.toThrow(AnthropicProviderDisabledError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("request bien formado (Opus 4.7+)", () => {
  it("sin temperature/top_p/top_k, con thinking adaptativo y tools del catálogo", async () => {
    vi.stubEnv("AI_ANTHROPIC_API_KEY", "sk-test-not-real");
    const fetchSpy = mockFetchOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    const { AnthropicProvider } = await loadProvider();
    await new AnthropicProvider().plan(SESSION_REQ);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("claude-opus-4-8"); // default AI_MODEL
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.tools.map((t: { name: string }) => t.name)).toContain("incidents_overview");
    for (const t of body.tools) {
      expect(t.input_schema.additionalProperties).toBe(false);
    }
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });
});

describe("parseo de respuestas", () => {
  beforeEach(() => vi.stubEnv("AI_ANTHROPIC_API_KEY", "sk-test-not-real"));

  it("stop_reason tool_use → tool_calls filtradas por catálogo", async () => {
    mockFetchOnce({
      content: [
        { type: "tool_use", id: "tu_1", name: "incidents_overview", input: { severidades: ["critica"] } },
        { type: "tool_use", id: "tu_2", name: "drop_tables", input: {} }, // fuera de catálogo
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 200, output_tokens: 30 },
    });
    const { AnthropicProvider } = await loadProvider();
    const res = await new AnthropicProvider().plan(SESSION_REQ);
    expect(res.kind).toBe("tool_calls");
    if (res.kind === "tool_calls") {
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls[0].tool).toBe("incidents_overview");
      expect(res.usage?.inputTokens).toBe(200);
    }
  });

  it("stop_reason end_turn → final con texto concatenado", async () => {
    mockFetchOnce({
      content: [
        { type: "text", text: "Hay un incidente [S1]." },
        { type: "text", text: "Verificá la fuente." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    const { AnthropicProvider } = await loadProvider();
    const res = await new AnthropicProvider().plan(SESSION_REQ);
    expect(res.kind).toBe("final");
    if (res.kind === "final") expect(res.answer).toContain("[S1]");
  });

  it("stop_reason refusal → error controlado", async () => {
    mockFetchOnce({ content: [], stop_reason: "refusal", usage: {} });
    const { AnthropicProvider } = await loadProvider();
    await expect(new AnthropicProvider().plan(SESSION_REQ)).rejects.toThrow(/refusal/);
  });

  it("HTTP != 2xx → error sin filtrar la key", async () => {
    mockFetchOnce({}, 429);
    const { AnthropicProvider } = await loadProvider();
    await expect(new AnthropicProvider().plan(SESSION_REQ)).rejects.toThrow(/HTTP 429/);
  });
});

describe("costo estimado (pricing cacheado)", () => {
  it("opus-4-8: $5/$25 por MTok", async () => {
    const { estimateCostUsd } = await loadProvider();
    // 1M in + 1M out = 5 + 25 = 30 USD
    expect(estimateCostUsd("claude-opus-4-8", 1_000_000, 1_000_000)).toBeCloseTo(30);
    expect(estimateCostUsd("claude-haiku-4-5", 1_000_000, 0)).toBeCloseTo(1);
    // modelo desconocido → pricing opus (conservador)
    expect(estimateCostUsd("modelo-x", 1_000_000, 0)).toBeCloseTo(5);
  });
});
