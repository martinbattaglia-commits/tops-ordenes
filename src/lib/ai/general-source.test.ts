// Pirámide de conocimiento · CONTEXTO GENERAL (tool local, sin API externa).
// Ampliación 2026-07-08: tema `deportes` + la limitación de `dolar` nombra el
// follow-up `fx_bna_quote`. Invariante: jamás inventa, jamás "no encontré".

import { describe, expect, it } from "vitest";
import { resolveGeneralContext } from "./general-source";

describe("resolveGeneralContext", () => {
  it("fecha/hora: reloj del servidor, zona Argentina, sin inventar", () => {
    const [row] = resolveGeneralContext({ tema: "fecha" });
    expect(row.kind).toBe("fecha");
    expect(row.fuente).toMatch(/reloj del servidor/i);
  });

  it("dolar: limitación honesta que nombra el follow-up fx_bna_quote", () => {
    const [row] = resolveGeneralContext({ tema: "dolar" });
    expect(row.kind).toBe("limitacion");
    expect(row.detalle).toMatch(/fx_bna_quote/);
    expect(row.detalle).not.toMatch(/no encontr/i);
  });

  it("deportes: limitación honesta (resultados en tiempo real), no inventa", () => {
    const [row] = resolveGeneralContext({ tema: "deportes" });
    expect(row.kind).toBe("limitacion");
    expect(row.detalle).toMatch(/resultado|deport/i);
    expect(row.detalle).not.toMatch(/no encontr/i);
  });

  it("noticias: limitación honesta que sugiere grounding/búsqueda", () => {
    const [row] = resolveGeneralContext({ tema: "noticias" });
    expect(row.kind).toBe("limitacion");
    expect(row.detalle).toMatch(/grounding|búsqueda|proveedor/i);
  });
});
