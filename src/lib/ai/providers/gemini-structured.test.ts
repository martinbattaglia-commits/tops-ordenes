// LINK-WA-002 · E1.1 — GeminiProvider.generateJson (salida estructurada).
//
// Camino de ANÁLISIS, distinto del planner conversacional plan():
//   · SIN tools ⇒ ninguna acción de negocio puede dispararse desde el modelo;
//   · JSON nativo ⇒ el contrato zod valida sobre un objeto, no sobre prosa;
//   · usage real ⇒ el costo auditado es MEDIDO, no estimado a ojo;
//   · fail-closed sin key ⇒ cero red.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEMINI_PRICING_PER_MTOK, estimateGeminiCostUsd } from "./gemini";

const ORIGINAL_FETCH = globalThis.fetch;

function okResponse(text: string, promptTokens = 6000, candTokens = 800) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: candTokens },
    }),
  } as unknown as Response;
}

async function freshProvider() {
  vi.resetModules();
  const { GeminiProvider } = await import("./gemini");
  return new GeminiProvider();
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("G1 · fail-closed: sin key no hay red", () => {
  it("lanza y NO llama a fetch", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const p = await freshProvider();
    await expect(
      p.generateJson({ system: "S", prompt: "P", maxOutputTokens: 2000 }),
    ).rejects.toThrow(/AI_GEMINI_API_KEY|GEMINI_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("G2 · el pedido de análisis NO lleva herramientas", () => {
  it("cero functionDeclarations y JSON forzado por responseMimeType", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "k-test");
    vi.stubEnv("AI_MODEL", "gemini-2.5-flash");
    const fetchSpy = vi.fn(async () => okResponse('{"clasificacion":{}}'));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const p = await freshProvider();
    await p.generateJson({ system: "SYS", prompt: "EVIDENCIA", maxOutputTokens: 2000 });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.tools).toBeUndefined();               // ⇐ la invariante
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.maxOutputTokens).toBe(2000); // tope de salida E1.1
    expect(body.systemInstruction.parts[0].text).toBe("SYS");
  });

  it("la key viaja en header, nunca en la URL", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "k-secreta");
    const fetchSpy = vi.fn(async () => okResponse("{}"));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const p = await freshProvider();
    await p.generateJson({ system: "S", prompt: "P", maxOutputTokens: 500 });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("k-secreta");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-secreta");
  });
});

describe("G3 · usage REAL ⇒ costo medido", () => {
  it("devuelve tokens del usageMetadata y el costo del modelo en uso", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "k-test");
    vi.stubEnv("AI_MODEL", "gemini-2.5-flash");
    globalThis.fetch = vi.fn(async () => okResponse('{"ok":1}', 8000, 2000)) as unknown as typeof fetch;
    const p = await freshProvider();
    const out = await p.generateJson({ system: "S", prompt: "P", maxOutputTokens: 2000 });

    expect(out.text).toBe('{"ok":1}');
    expect(out.usage.inputTokens).toBe(8000);
    expect(out.usage.outputTokens).toBe(2000);
    // Flash: 0,3 / 2,5 USD por millón ⇒ el techo por corrida autorizado por Dirección.
    const esperado = (8000 * 0.3 + 2000 * 2.5) / 1_000_000;
    expect(out.usage.costUsd).toBeCloseTo(esperado, 10);
    expect(out.usage.costUsd).toBeCloseTo(0.0074, 6);
  });

  it("el techo por corrida (8.000 in / 2.000 out) cuesta menos de un centavo con Flash", () => {
    expect(estimateGeminiCostUsd("gemini-2.5-flash", 8000, 2000)).toBeLessThan(0.01);
  });

  it("Flash está tarifado y es más barato que Pro en ambas puntas", () => {
    const flash = GEMINI_PRICING_PER_MTOK["gemini-2.5-flash"];
    const pro = GEMINI_PRICING_PER_MTOK["gemini-2.5-pro"];
    expect(flash.input).toBeLessThan(pro.input);
    expect(flash.output).toBeLessThan(pro.output);
  });
});

describe("G4 · errores del proveedor no filtran secretos", () => {
  it("HTTP no-2xx ⇒ error con el status, sin key ni cuerpo", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "k-secreta");
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 429, json: async () => ({ error: "quota" }),
    }) as unknown as Response) as unknown as typeof fetch;
    const p = await freshProvider();
    await p.generateJson({ system: "S", prompt: "P", maxOutputTokens: 100 }).then(
      () => expect.unreachable("debía fallar"),
      (e: Error) => {
        expect(e.message).toContain("429");
        expect(e.message).not.toContain("k-secreta");
      },
    );
  });

  it("respuesta sin candidates ⇒ texto vacío (lo invalida el contrato zod, no explota acá)", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "k-test");
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({}),
    }) as unknown as Response) as unknown as typeof fetch;
    const p = await freshProvider();
    const out = await p.generateJson({ system: "S", prompt: "P", maxOutputTokens: 100 });
    expect(out.text).toBe("");
    expect(out.usage.inputTokens).toBe(0);
    expect(out.usage.costUsd).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Remediación de la revisión adversarial independiente (E1.1)
// ─────────────────────────────────────────────────────────────────────────────

describe("G5 · H6 — los thinking tokens se facturan como salida y se cuentan", () => {
  it("thoughtsTokenCount suma al costo en lugar de desaparecer", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "k-test");
    vi.stubEnv("AI_MODEL", "gemini-2.5-flash");
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"ok":1}' }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 400, thoughtsTokenCount: 600 },
      }),
    }) as unknown as Response) as unknown as typeof fetch;
    const p = await freshProvider();
    const out = await p.generateJson({ system: "S", prompt: "P", maxOutputTokens: 2000 });
    expect(out.usage.outputTokens).toBe(1000); // 400 visibles + 600 de razonamiento
    expect(out.usage.costUsd).toBeCloseTo((1000 * 0.3 + 1000 * 2.5) / 1_000_000, 10);
  });
});

describe("G6 · H8 — los cortes del proveedor se distinguen, no se disfrazan de JSON inválido", () => {
  it("salida cortada por MAX_TOKENS ⇒ error explícito con el tope", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "k-test");
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"clasificacion":{"clase":"re' }] }, finishReason: "MAX_TOKENS" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 2000 },
      }),
    }) as unknown as Response) as unknown as typeof fetch;
    const p = await freshProvider();
    await expect(p.generateJson({ system: "S", prompt: "P", maxOutputTokens: 2000 }))
      .rejects.toThrow(/MAX_TOKENS|2000/);
  });

  it("JSON completo con finishReason MAX_TOKENS no se descarta por las dudas", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "k-test");
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"ok":1}' }] }, finishReason: "MAX_TOKENS" }],
        usageMetadata: {},
      }),
    }) as unknown as Response) as unknown as typeof fetch;
    const p = await freshProvider();
    await expect(p.generateJson({ system: "S", prompt: "P", maxOutputTokens: 2000 }))
      .resolves.toMatchObject({ text: '{"ok":1}' });
  });

  it("bloqueo por safety ⇒ error que nombra la causa", async () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "k-test");
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }),
    }) as unknown as Response) as unknown as typeof fetch;
    const p = await freshProvider();
    await expect(p.generateJson({ system: "S", prompt: "P", maxOutputTokens: 500 }))
      .rejects.toThrow(/SAFETY/);
  });
});
