// Command center 2026-07-07 · Catálogo de sugerencias CONSCIENTE DE COBERTURA.
// Regla de producto: ninguna sugerencia principal puede terminar en fallback
// genérico — cada prompt 'supported' DEBE rutear a una tool específica del
// router determinístico (no al default search_knowledge).

import { describe, expect, it } from "vitest";
import {
  COPILOT_SUGGESTION_SECTIONS,
  getPrincipalSections,
} from "./copilot-suggestions";
import { pickTools } from "./providers/mock";

describe("catálogo de sugerencias · estructura", () => {
  it("hay al menos 12 sugerencias 'supported' visibles, agrupadas por sección", () => {
    const principal = getPrincipalSections();
    const prompts = principal.flatMap((s) => s.prompts);
    expect(prompts.length).toBeGreaterThanOrEqual(12);
    expect(principal.length).toBeGreaterThanOrEqual(6);
  });

  it("incluye las secciones clave del sistema", () => {
    const ids = COPILOT_SUGGESTION_SECTIONS.map((s) => s.id);
    for (const req of [
      "gerencia",
      "facturacion",
      "compras",
      "tesoreria",
      "compliance",
      "documentos",
      "contratos",
      "vacancia",
      "sistema",
    ]) {
      expect(ids, `falta sección ${req}`).toContain(req);
    }
  });

  it("cada sección tiene icono, color, descripción y 3-5 prompts", () => {
    for (const s of COPILOT_SUGGESTION_SECTIONS) {
      expect(s.icon.length, s.id).toBeGreaterThan(0);
      expect(s.color, s.id).toMatch(/^#([0-9a-f]{6})$/i);
      expect(s.description.length, s.id).toBeGreaterThan(10);
      expect(s.prompts.length, s.id).toBeGreaterThanOrEqual(3);
      expect(s.prompts.length, s.id).toBeLessThanOrEqual(5);
      for (const p of s.prompts) {
        expect(p.prompt.trim().length, `${s.id}/${p.id}`).toBeGreaterThan(8);
        expect(p.label.trim().length, `${s.id}/${p.id}`).toBeGreaterThan(3);
      }
    }
  });
});

describe("command center · grilla equilibrada (smoke 2026-07-07: hueco abajo a la derecha)", () => {
  it("cantidad PAR de secciones principales — la grilla de 2 columnas cierra sin hueco", () => {
    expect(getPrincipalSections().length % 2).toBe(0);
  });

  it("existe la sección adicional de salud operativa/riesgos, real y supported", () => {
    const salud = getPrincipalSections().find((s) => s.id === "salud");
    expect(salud).toBeDefined();
    expect(salud!.prompts.length).toBeGreaterThanOrEqual(3);
  });
});

describe("catálogo de sugerencias · COBERTURA GARANTIZADA (anti-frustración)", () => {
  it("las principales son solo 'supported'; partial/experimental no se muestran", () => {
    for (const s of getPrincipalSections()) {
      for (const p of s.prompts) {
        expect(p.coverage, `${s.id}/${p.id}`).toBe("supported");
      }
    }
  });

  it("CADA prompt supported rutea a una tool específica (nunca al default genérico)", () => {
    // El default del router es search_knowledge con la pregunta entera como
    // query — eso es lo que produce el fallback genérico. Ninguna sugerencia
    // principal puede caer ahí.
    for (const s of getPrincipalSections()) {
      for (const p of s.prompts) {
        const calls = pickTools(p.prompt);
        expect(calls.length, `${s.id}/${p.id}: sin tool`).toBeGreaterThan(0);
        const isGenericDefault =
          calls.length === 1 &&
          calls[0].tool === "search_knowledge" &&
          String(calls[0].args.query ?? "").length > 40; // default = pregunta entera
        expect(isGenericDefault, `${s.id}/${p.id} ("${p.prompt}") cae en el default genérico`).toBe(
          false
        );
      }
    }
  });
});
