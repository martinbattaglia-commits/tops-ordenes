import { describe, expect, it, vi } from "vitest";
import {
  CustodyVisionProviderError,
  OpenAICustodyVisionProvider,
} from "@/lib/custody/openai-vision-provider";
import { CUSTODY_VISION_MODEL } from "@/lib/custody/openai-vision-contract";

const image = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]), mimeType: "image/jpeg" as const };
const result = {
  identity: 90,
  packaging: 90,
  quantity: 90,
  condition: 90,
  model_confidence: 0.9,
  verdict: "coincide",
  packaging_changed: false,
  missing_items_suspected: false,
  damage_suspected: false,
  observations: [],
  zones: [],
};

function response(over: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    id: "resp_test",
    status: "completed",
    model: CUSTODY_VISION_MODEL,
    system_fingerprint: "fp_test",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }],
    ...over,
  }), { status: 200, headers: { "x-request-id": "req_test" } });
}

describe("proveedor OpenAI Vision server-side", () => {
  it("sin credencial falla antes de la red", async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAICustodyVisionProvider({ apiKey: "", fetchImpl });
    await expect(provider.compare(image, image)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("usa Responses, store false, imágenes high y schema estricto", async () => {
    const fetchImpl = vi.fn(async () => response());
    const provider = new OpenAICustodyVisionProvider({ apiKey: "test-only-key", fetchImpl });
    const out = await provider.compare(image, image);
    expect(out.result.identity).toBe(90);
    expect(out.providerResponseId).toBe("resp_test");
    expect(out.requestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.responseSha256).toMatch(/^[0-9a-f]{64}$/);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(CUSTODY_VISION_MODEL);
    expect(body.store).toBe(false);
    expect(body.input[0].content.filter((v: { type: string }) => v.type === "input_image"))
      .toHaveLength(2);
    expect(body.input[0].content[1].detail).toBe("high");
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true });
  });

  it("rechaza modelo, JSON o salida que divergen del contrato", async () => {
    for (const raw of [
      response({ model: "moving-alias" }),
      new Response("not-json", { status: 200 }),
      response({ output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] }),
    ]) {
      const provider = new OpenAICustodyVisionProvider({ apiKey: "test-only-key", fetchImpl: vi.fn(async () => raw) });
      await expect(provider.compare(image, image)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    }
  });

  it("clasifica timeout sin incluir credencial ni imágenes en el error", async () => {
    const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const provider = new OpenAICustodyVisionProvider({ apiKey: "test-only-key", fetchImpl: fetchImpl as typeof fetch, timeoutMs: 5 });
    let caught: unknown;
    try { await provider.compare(image, image); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(CustodyVisionProviderError);
    expect(String(caught)).toBe("CustodyVisionProviderError: PROVIDER_TIMEOUT");
    expect(String(caught)).not.toContain("test-only-key");
    expect(String(caught)).not.toContain("base64");
  });
});
