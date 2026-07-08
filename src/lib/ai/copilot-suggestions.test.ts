// Command center 2026-07-07 · Catálogo de sugerencias CONSCIENTE DE COBERTURA.
// Regla de producto: ninguna sugerencia principal puede terminar en fallback
// genérico — cada prompt 'supported' DEBE rutear a una tool específica del
// router determinístico (no al default search_knowledge).

import { describe, expect, it } from "vitest";
import {
  COPILOT_SUGGESTION_SECTIONS,
  getManualNexusSection,
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
      // Comercial · CRM (id 'contratos') admite hasta 7: 3 reportes comerciales
      // (pipeline/prioritarios/reactivación) + 4 de contratos. El resto, 3–5.
      const maxPrompts = s.id === "contratos" ? 7 : 5;
      expect(s.prompts.length, s.id).toBeLessThanOrEqual(maxPrompts);
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

// ── Reportes ejecutivos (2026-07-07) · el Copilot no es un buscador ───────────
// Regla de producto: las sugerencias principales dejan de ser consultas triviales
// ("Saldo en Santander") y pasan a ser REPORTES EJECUTIVOS: chip corto + prompt
// elaborado que dispara un informe con KPIs/gráficos/decisión. Cada una declara
// además su objetivo de decisión, fuentes, visuales esperados y fallback.
describe("catálogo de sugerencias · REPORTES EJECUTIVOS", () => {
  it("chip corto (≤32) + prompt elaborado (≥80) — label para el botón, prompt para el informe", () => {
    for (const s of getPrincipalSections()) {
      for (const p of s.prompts) {
        expect(p.label.length, `${s.id}/${p.id}: chip largo ("${p.label}")`).toBeLessThanOrEqual(32);
        expect(
          p.prompt.length,
          `${s.id}/${p.id}: prompt trivial, no dispara un informe ejecutivo`
        ).toBeGreaterThanOrEqual(80);
      }
    }
  });

  it("cada reporte declara objetivo de decisión, fuentes, visuales y fallback", () => {
    for (const s of getPrincipalSections()) {
      for (const p of s.prompts) {
        expect(p.decisionGoal?.trim().length, `${s.id}/${p.id}: sin objetivo de decisión`).toBeTruthy();
        expect(p.sources?.length, `${s.id}/${p.id}: sin fuentes esperadas`).toBeTruthy();
        expect(p.visuals?.length, `${s.id}/${p.id}: sin visuales esperados`).toBeTruthy();
        expect(p.fallback?.trim().length, `${s.id}/${p.id}: sin fallback de datos faltantes`).toBeTruthy();
      }
    }
  });
});

// ── Manual Nexus · Ayuda Interna (preview, 2026-07-08) ───────────────────────
describe("Manual Nexus · Ayuda Interna", () => {
  it("existe con 10 sugerencias 'supported' (C1.5); chip corto + prompt elaborado", () => {
    const s = getManualNexusSection();
    expect(s.id).toBe("manual_nexus");
    expect(s.coverage).toBe("supported");
    expect(s.prompts).toHaveLength(10);
    for (const p of s.prompts) {
      expect(p.coverage, p.id).toBe("supported");
      expect(p.label.length, `${p.id}: chip largo`).toBeLessThanOrEqual(32);
      expect(p.prompt.length, `${p.id}: prompt trivial`).toBeGreaterThanOrEqual(60);
    }
  });
  it("NO se filtra en las principales (no toca el gate de routing ni la regla 3–5)", () => {
    expect(getPrincipalSections().some((s) => s.id === "manual_nexus")).toBe(false);
    expect(COPILOT_SUGGESTION_SECTIONS.some((s) => s.id === "manual_nexus")).toBe(false);
  });
  it("son de AYUDA INTERNA: citan el Manual de Usuario (no reporte gerencial)", () => {
    const citan = getManualNexusSection().prompts.filter((p) =>
      /manual de usuario/i.test(p.prompt)
    ).length;
    expect(citan).toBeGreaterThanOrEqual(6);
  });
});

// ── Comercial · CRM · reportes comerciales avanzados (2026-07-08) ─────────────
describe("Comercial · CRM · pipeline / prospectos / reactivación", () => {
  const crm = COPILOT_SUGGESTION_SECTIONS.find((s) => s.id === "contratos")!;

  it("la sección CRM se titula 'Comercial · CRM' y sigue supported", () => {
    expect(crm).toBeDefined();
    expect(crm.title).toBe("Comercial · CRM");
    expect(crm.coverage).toBe("supported");
  });

  it("agrega las 3 recomendaciones comerciales SIN borrar las de contratos", () => {
    const ids = crm.prompts.map((p) => p.id);
    for (const id of ["pipeline-inteligente", "prospectos-prioritarios", "reactivacion-comercial"]) {
      expect(ids, `falta ${id}`).toContain(id);
    }
    for (const id of ["renovaciones", "riesgo-contractual", "vs-operacion", "impacto-venc"]) {
      expect(ids, `se borró la recomendación existente ${id}`).toContain(id);
    }
    const byId = (id: string) => crm.prompts.find((p) => p.id === id)!;
    expect(byId("pipeline-inteligente").label).toBe("Pipeline inteligente");
    expect(byId("prospectos-prioritarios").label).toBe("Prospectos prioritarios");
    expect(byId("reactivacion-comercial").label).toBe("Reactivación comercial");
  });

  it("cada comercial es un reporte ejecutivo (prompt largo + metadata + tool real, no default)", () => {
    for (const id of ["pipeline-inteligente", "prospectos-prioritarios", "reactivacion-comercial"]) {
      const p = crm.prompts.find((x) => x.id === id)!;
      expect(p.coverage, id).toBe("supported");
      expect(p.label.length, `${id} label ≤32`).toBeLessThanOrEqual(32);
      expect(p.prompt.length, `${id} prompt ≥80`).toBeGreaterThanOrEqual(80);
      expect(p.decisionGoal?.trim().length, `${id} decisionGoal`).toBeTruthy();
      expect(p.sources?.length, `${id} sources`).toBeTruthy();
      expect(p.visuals?.length, `${id} visuals`).toBeTruthy();
      expect(p.fallback?.trim().length, `${id} fallback`).toBeTruthy();
      const calls = pickTools(p.prompt);
      const generic =
        calls.length === 1 &&
        calls[0].tool === "search_knowledge" &&
        String(calls[0].args.query ?? "").length > 40;
      expect(generic, `${id} cae en el default genérico`).toBe(false);
    }
  });
});
