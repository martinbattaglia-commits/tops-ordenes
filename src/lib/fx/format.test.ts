import { describe, it, expect } from "vitest";
import { fmtArs, fmtHoraAr, resolveFxCardKind } from "./format";

describe("fmtArs", () => {
  it("formatea con miles (punto), decimales (coma) y prefijo ARS", () => {
    expect(fmtArs(1515)).toBe("ARS 1.515,00");
    expect(fmtArs(1250.5)).toBe("ARS 1.250,50");
  });
});

describe("fmtHoraAr", () => {
  it("devuelve HH:mm en horario de Argentina (UTC-3)", () => {
    // 18:20 UTC → 15:20 ART
    expect(fmtHoraAr("2026-07-07T18:20:00.000Z")).toBe("15:20");
  });

  it("null cuando el ISO es ausente o inválido", () => {
    expect(fmtHoraAr(null)).toBeNull();
    expect(fmtHoraAr(undefined)).toBeNull();
    expect(fmtHoraAr("no-es-fecha")).toBeNull();
  });
});

describe("resolveFxCardKind", () => {
  it("loading tiene precedencia máxima", () => {
    expect(resolveFxCardKind({ loading: true, sell: 1515, status: "fresh" })).toBe("loading");
  });

  it("unavailable si error, status unavailable, o sell nulo", () => {
    expect(resolveFxCardKind({ error: true, sell: 1515 })).toBe("unavailable");
    expect(resolveFxCardKind({ sell: null })).toBe("unavailable");
    expect(resolveFxCardKind({ sell: 1515, status: "unavailable" })).toBe("unavailable");
  });

  it("stale si stale=true o status stale (con dato)", () => {
    expect(resolveFxCardKind({ sell: 1515, stale: true })).toBe("stale");
    expect(resolveFxCardKind({ sell: 1515, status: "stale" })).toBe("stale");
  });

  it("loaded en el caso feliz", () => {
    expect(resolveFxCardKind({ sell: 1515, status: "fresh" })).toBe("loaded");
  });
});
