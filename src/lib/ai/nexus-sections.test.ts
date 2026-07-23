// Slice A (manual de aceptación 2026-07-07) · matcher de secciones de Nexus.
// Falla real de la batería: el matcher exigía TODOS los tokens en UNA sección
// (`every`) y el router pasa la frase completa → "¿Qué secciones tiene Nexus y
// para qué sirve cada una?" y "¿Dónde veo órdenes de compra, compliance y
// contratos?" devolvían 0 filas (vacío injustificado).

import { describe, expect, it } from "vitest";
import { NEXUS_SECTIONS, resolveNexusSections } from "./nexus-sections";

describe("resolveNexusSections · frases reales del manual de aceptación", () => {
  it("pregunta de CATÁLOGO ('qué secciones tiene Nexus y para qué sirve cada una') → mapa completo", () => {
    const rows = resolveNexusSections({
      query: "Qué secciones tiene Nexus y para qué sirve cada una",
      limit: 50,
    });
    expect(rows.length).toBe(Math.min(NEXUS_SECTIONS.length, 50));
  });

  it("consulta MULTI-OBJETIVO ('dónde veo OC, compliance y contratos') → una sección por objetivo", () => {
    const rows = resolveNexusSections({
      query: "Dónde veo órdenes de compra, compliance y contratos",
      limit: 50,
    });
    const routes = rows.map((r) => r.route);
    expect(routes).toContain("/compras/ordenes");
    expect(routes.some((r) => r.includes("/anmat") || r.includes("compliance"))).toBe(true);
    expect(routes).toContain("/comercial/contratos");
  });

  it("consulta puntual sigue devolviendo la sección más relevante primero", () => {
    const rows = resolveNexusSections({ query: "órdenes de compra", limit: 10 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].route).toBe("/compras/ordenes");
  });

  it("consulta sin relación real → vacío honesto (no devuelve cualquier cosa)", () => {
    const rows = resolveNexusSections({ query: "sarasa inexistente xyz", limit: 10 });
    expect(rows).toEqual([]);
  });
});
