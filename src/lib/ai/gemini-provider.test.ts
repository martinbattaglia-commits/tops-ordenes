// F5.2-lite · Tests del GeminiProvider (proveedor PRINCIPAL) — SIN RED:
// fetch global mockeado. Verifica fail-closed sin key, request bien formado
// (function calling, schema sanitizado, key en header y NUNCA en URL),
// parseo functionCall/text/blocked, y costo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REQ = {
  system: "system de prueba",
  question: "¿Qué incidentes críticos están abiertos?",
  history: [{ role: "user" as const, content: "hola" }, { role: "assistant" as const, content: "hola!" }],
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
  return import("./providers/gemini");
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("AI_PROVIDER", "gemini");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fail-closed sin API key", () => {
  it("plan() lanza ANTES de tocar la red (sin AI_GEMINI_API_KEY ni GEMINI_API_KEY)", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchSpy = mockFetchOnce({});
    const { GeminiProvider, GeminiProviderDisabledError } = await loadProvider();
    await expect(new GeminiProvider().plan(REQ)).rejects.toThrow(GeminiProviderDisabledError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fallback GEMINI_API_KEY habilita cuando falta la primaria", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    const fetchSpy = mockFetchOnce({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
    });
    const { GeminiProvider } = await loadProvider();
    const res = await new GeminiProvider().plan(REQ);
    expect(res.kind).toBe("final");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("request bien formado", () => {
  beforeEach(() => vi.stubEnv("AI_GEMINI_API_KEY", "test-key-not-real"));

  it("URL con modelo default gemini-2.5-pro, key SOLO en header, tools y schemas sanitizados", async () => {
    const fetchSpy = mockFetchOnce({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
      usageMetadata: {},
    });
    const { GeminiProvider } = await loadProvider();
    await new GeminiProvider().plan(REQ);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    );
    expect(String(url)).not.toContain("key="); // jamás la key en la URL
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key-not-real");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.systemInstruction.parts[0].text).toBe("system de prueba");
    expect(body.generationConfig.temperature).toBe(0.2);
    // history: assistant → role "model"
    expect(body.contents[1].role).toBe("model");
    const decls = body.tools[0].functionDeclarations;
    expect(decls.map((d: { name: string }) => d.name)).toContain("incidents_overview");
    // Schemas sanitizados: sin claves no soportadas por Gemini
    const flat = JSON.stringify(decls);
    expect(flat).not.toContain("additionalProperties");
    expect(flat).not.toContain('"minimum"');
    expect(flat).not.toContain('"maximum"');
  });

  it("AI_MODEL override respeta el modelo pedido", async () => {
    vi.stubEnv("AI_MODEL", "gemini-2.5-flash");
    const fetchSpy = mockFetchOnce({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
    });
    const { GeminiProvider } = await loadProvider();
    await new GeminiProvider().plan(REQ);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("gemini-2.5-flash:generateContent");
  });
});

describe("parseo de respuestas", () => {
  beforeEach(() => vi.stubEnv("AI_GEMINI_API_KEY", "test-key-not-real"));

  it("functionCall → tool_calls filtradas por catálogo + usage", async () => {
    mockFetchOnce({
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: "incidents_overview", args: { severidades: ["critica"] } } },
              { functionCall: { name: "drop_tables", args: {} } }, // fuera de catálogo
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 30 },
    });
    const { GeminiProvider } = await loadProvider();
    const res = await new GeminiProvider().plan(REQ);
    expect(res.kind).toBe("tool_calls");
    if (res.kind === "tool_calls") {
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls[0].tool).toBe("incidents_overview");
      expect(res.toolCalls[0].args).toMatchObject({ severidades: ["critica"] });
      expect(res.usage?.inputTokens).toBe(200);
    }
  });

  it("texto → final concatenado", async () => {
    mockFetchOnce({
      candidates: [{ content: { parts: [{ text: "Hay un incidente [S1]." }, { text: "Verificá." }] } }],
    });
    const { GeminiProvider } = await loadProvider();
    const res = await new GeminiProvider().plan(REQ);
    if (res.kind === "final") expect(res.answer).toContain("[S1]");
    else throw new Error("esperaba final");
  });

  it("promptFeedback.blockReason → error controlado", async () => {
    mockFetchOnce({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] });
    const { GeminiProvider } = await loadProvider();
    await expect(new GeminiProvider().plan(REQ)).rejects.toThrow(/SAFETY/);
  });

  it("HTTP != 2xx → error sin filtrar la key", async () => {
    mockFetchOnce({}, 429);
    const { GeminiProvider } = await loadProvider();
    let message = "";
    await new GeminiProvider().plan(REQ).catch((e: Error) => {
      message = e.message;
    });
    expect(message).toContain("HTTP 429");
    expect(message).not.toContain("test-key-not-real");
  });
});

describe("costo estimado (pricing cacheado)", () => {
  it("gemini-2.5-pro $1.25/$10 · flash $0.30/$2.50 · desconocido → pro", async () => {
    const { estimateGeminiCostUsd } = await loadProvider();
    expect(estimateGeminiCostUsd("gemini-2.5-pro", 1_000_000, 1_000_000)).toBeCloseTo(11.25);
    expect(estimateGeminiCostUsd("gemini-2.5-flash", 1_000_000, 0)).toBeCloseTo(0.3);
    expect(estimateGeminiCostUsd("gemini-x", 1_000_000, 0)).toBeCloseTo(1.25);
  });
});
