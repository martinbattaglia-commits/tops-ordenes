import { describe, it, expect } from "vitest";
import {
  parseCriptoyaBna,
  parseDolarApiOficial,
  resolveFxQuote,
  toQuote,
  FX_UNAVAILABLE,
  type FxParsed,
  type FxQuote,
} from "./parse";

describe("parseCriptoyaBna", () => {
  it("extrae SÓLO la clave `bna` (Banco Nación) — ask=venta, bid=compra", () => {
    const raw = {
      galicia: { ask: 1470, bid: 1420, time: 1766167200 },
      bna: { ask: 1515, bid: 1465, time: 1783477915 },
    };
    const r = parseCriptoyaBna(raw);
    expect(r).not.toBeNull();
    expect(r!.sell).toBe(1515);
    expect(r!.buy).toBe(1465);
    expect(r!.updatedAt).toBe(new Date(1783477915 * 1000).toISOString());
  });

  it("devuelve null si no existe la clave `bna` (no cae a otro banco)", () => {
    expect(parseCriptoyaBna({ galicia: { ask: 1470, bid: 1420 } })).toBeNull();
  });

  it("devuelve null si `ask` no es un número positivo válido", () => {
    expect(parseCriptoyaBna({ bna: { ask: 0, bid: 1465 } })).toBeNull();
    expect(parseCriptoyaBna({ bna: { ask: "1515", bid: 1465 } })).toBeNull();
  });

  it("tolera compra/tiempo ausentes (buy=null, updatedAt=null)", () => {
    const r = parseCriptoyaBna({ bna: { ask: 1515 } });
    expect(r).toEqual<FxParsed>({ sell: 1515, buy: null, updatedAt: null });
  });

  it("no rompe con basura", () => {
    expect(parseCriptoyaBna(null)).toBeNull();
    expect(parseCriptoyaBna("nope")).toBeNull();
    expect(parseCriptoyaBna({ bna: null })).toBeNull();
  });
});

describe("parseDolarApiOficial", () => {
  it("mapea venta/compra/fechaActualizacion", () => {
    const raw = {
      moneda: "USD",
      casa: "oficial",
      compra: 1465,
      venta: 1515,
      fechaActualizacion: "2026-07-07T18:20:00.000Z",
    };
    const r = parseDolarApiOficial(raw);
    expect(r).toEqual<FxParsed>({
      sell: 1515,
      buy: 1465,
      updatedAt: "2026-07-07T18:20:00.000Z",
    });
  });

  it("devuelve null si falta `venta`", () => {
    expect(parseDolarApiOficial({ compra: 1465 })).toBeNull();
  });
});

describe("toQuote", () => {
  it("marca fresh, Banco Nación, venta, USD/ARS", () => {
    const q = toQuote({ sell: 1515, buy: 1465, updatedAt: null }, "criptoya:bna");
    expect(q.source).toBe("Banco Nación");
    expect(q.type).toBe("venta");
    expect(q.pair).toBe("USD/ARS");
    expect(q.status).toBe("fresh");
    expect(q.stale).toBe(false);
    expect(q.provider).toBe("criptoya:bna");
  });
});

const ok: FxParsed = { sell: 1515, buy: 1465, updatedAt: null };

describe("resolveFxQuote (orquestación)", () => {
  it("usa la primaria cuando responde → fresh", async () => {
    const q = await resolveFxQuote({
      primary: async () => ok,
      fallback: async () => {
        throw new Error("no debería llamarse");
      },
      cached: null,
    });
    expect(q.status).toBe("fresh");
    expect(q.provider).toBe("criptoya:bna");
    expect(q.sell).toBe(1515);
  });

  it("cae al fallback si la primaria lanza → fresh (dolarapi)", async () => {
    const errors: string[] = [];
    const q = await resolveFxQuote({
      primary: async () => {
        throw new Error("timeout");
      },
      fallback: async () => ({ sell: 1516, buy: 1466, updatedAt: null }),
      cached: null,
      onError: (stage) => errors.push(stage),
    });
    expect(q.status).toBe("fresh");
    expect(q.provider).toBe("dolarapi:oficial");
    expect(q.sell).toBe(1516);
    expect(errors).toEqual(["primary"]);
  });

  it("cae al fallback si la primaria devuelve null (parseo fallido)", async () => {
    const q = await resolveFxQuote({
      primary: async () => null,
      fallback: async () => ok,
      cached: null,
    });
    expect(q.provider).toBe("dolarapi:oficial");
  });

  it("si ambas fallan y hay caché → último dato (stale)", async () => {
    const cached: FxQuote = toQuote(ok, "criptoya:bna");
    const q = await resolveFxQuote({
      primary: async () => {
        throw new Error("down");
      },
      fallback: async () => null,
      cached,
    });
    expect(q.status).toBe("stale");
    expect(q.stale).toBe(true);
    expect(q.sell).toBe(1515);
  });

  it("si ambas fallan y no hay caché → unavailable", async () => {
    const q = await resolveFxQuote({
      primary: async () => null,
      fallback: async () => null,
      cached: null,
    });
    expect(q).toEqual(FX_UNAVAILABLE);
    expect(q.status).toBe("unavailable");
    expect(q.sell).toBeNull();
  });

  it("nunca lanza aunque ambos fetchers exploten", async () => {
    await expect(
      resolveFxQuote({
        primary: async () => {
          throw new Error("boom");
        },
        fallback: async () => {
          throw new Error("boom2");
        },
        cached: null,
      })
    ).resolves.toEqual(FX_UNAVAILABLE);
  });
});
