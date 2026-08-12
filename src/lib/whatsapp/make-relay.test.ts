import { describe, expect, it, vi } from "vitest";
import {
  relayToMake,
  validateMakeRelayEndpoint,
  type RelayFetch,
} from "./make-relay";

const ENDPOINT = "https://hook.us2.make.com/relaySyntheticId123";
const RAW = "{\n  \"object\": \"whatsapp_business_account\"\n}";
const SIGNATURE = "sha256=sintetica";
const RELAY_ID = "a".repeat(64);

describe("Make relay · configuración fail-closed", () => {
  it("apagado por defecto no hace egress", async () => {
    const fetchImpl = vi.fn<RelayFetch>();
    const result = await relayToMake(RAW, SIGNATURE, {
      enabled: false,
      endpoint: ENDPOINT,
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, state: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["vacía", ""],
    ["http", "http://hook.us2.make.com/id"],
    ["host ajeno", "https://example.com/id"],
    ["subdominio engañoso", "https://hook.us2.make.com.example.com/id"],
    ["credenciales", "https://user:pass@hook.us2.make.com/id"],
    ["query", "https://hook.us2.make.com/id?next=otro"],
  ])("rechaza URL %s", async (_label, endpoint) => {
    expect(validateMakeRelayEndpoint(endpoint)).toBeNull();
    const fetchImpl = vi.fn<RelayFetch>();
    expect(await relayToMake(RAW, SIGNATURE, { enabled: true, endpoint, fetchImpl }))
      .toEqual({ ok: false, state: "misconfigured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Make relay · contrato de entrega", () => {
  it("conserva body y firma exactos y acepta cualquier 2xx", async () => {
    const fetchImpl: RelayFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await relayToMake(RAW, SIGNATURE, {
      enabled: true,
      endpoint: ENDPOINT,
      relayId: RELAY_ID,
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, state: "delivered" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(String(url)).toBe(ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(RAW);
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-hub-signature-256")).toBe(SIGNATURE);
    expect(headers.get("x-nexus-relay")).toBe("whatsapp-meta-v1");
    expect(headers.get("x-nexus-relay-id")).toBe(RELAY_ID);
  });

  it("un status no-2xx es reintentable para el llamador", async () => {
    const fetchImpl: RelayFetch = vi.fn(async () => new Response(null, { status: 503 }));
    expect(await relayToMake(RAW, SIGNATURE, {
      enabled: true,
      endpoint: ENDPOINT,
      fetchImpl,
    })).toEqual({ ok: false, state: "upstream_rejected" });
  });

  it("un error de red no expone el detalle", async () => {
    const fetchImpl: RelayFetch = vi.fn(async () => {
      throw new Error("falló con contenido sensible");
    });
    expect(await relayToMake(RAW, SIGNATURE, {
      enabled: true,
      endpoint: ENDPOINT,
      fetchImpl,
    })).toEqual({ ok: false, state: "network" });
  });

  it("aborta por timeout acotado", async () => {
    const fetchImpl: RelayFetch = vi.fn((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    );
    expect(await relayToMake(RAW, SIGNATURE, {
      enabled: true,
      endpoint: ENDPOINT,
      timeoutMs: 1,
      fetchImpl,
    })).toEqual({ ok: false, state: "timeout" });
  });
});
