// Renderer de markdown SEGURO y sin dependencias para el narrativo del Copilot
// (round "briefing premium" 2026-07-08). Se testea el PARSER puro; el componente
// React (CopilotChat) solo mapea estos bloques a elementos. Objetivo: que los
// asteriscos crudos NUNCA se vean y que las etiquetas ejecutivas (Evidencia,
// Recomendación, Riesgo…) se conviertan en badges.

import { describe, expect, it } from "vitest";
import {
  detectLabel,
  groupEntityCards,
  groupSections,
  parseBlocks,
  parseInline,
  sanitizeHref,
  sectionKindOf,
  type EntityCard,
} from "./markdown";

describe("parseInline · negrita/itálica/código/links/citas", () => {
  it("convierte **negrita** en un token bold (sin asteriscos crudos)", () => {
    const toks = parseInline("hola **mundo** chau");
    expect(toks).toEqual([
      { t: "text", value: "hola " },
      { t: "bold", value: "mundo" },
      { t: "text", value: " chau" },
    ]);
    // invariante clave: ningún token de texto conserva '**'
    expect(toks.every((t) => !t.value.includes("**"))).toBe(true);
  });

  it("itálica *simple* y `código`", () => {
    expect(parseInline("un *dato* y `code`")).toEqual([
      { t: "text", value: "un " },
      { t: "italic", value: "dato" },
      { t: "text", value: " y " },
      { t: "code", value: "code" },
    ]);
  });

  it("link seguro https → token link; javascript: → texto plano (no link)", () => {
    expect(parseInline("[abrir](https://drive.google.com/x)")).toEqual([
      { t: "link", value: "abrir", href: "https://drive.google.com/x" },
    ]);
    const xss = parseInline("[click](javascript:alert(1))");
    expect(xss.some((t) => t.t === "link")).toBe(false); // nunca un href peligroso
  });

  it("cita [S1] → token cite", () => {
    expect(parseInline("según Nexus [S2]")).toEqual([
      { t: "text", value: "según Nexus " },
      { t: "cite", value: "S2" },
    ]);
  });
});

describe("detectLabel · etiquetas ejecutivas → badge (FASE F)", () => {
  it("**Evidencia:** … → label Evidencia + resto", () => {
    expect(detectLabel("**Evidencia:** Existen 16 documentos")).toEqual({
      label: "Evidencia",
      tone: "muted",
      rest: "Existen 16 documentos",
    });
  });
  it("Recomendación / Acción → 'Acción recomendada' tono violeta (action)", () => {
    expect(detectLabel("Recomendación: Priorizar renovaciones")?.label).toBe("Acción recomendada");
    expect(detectLabel("Recomendación: Priorizar renovaciones")?.tone).toBe("action");
    expect(detectLabel("**Acción recomendada:** Revisar caja")?.tone).toBe("action");
  });
  it("Riesgo con número → label Riesgo tono danger", () => {
    expect(detectLabel("- **Riesgo 1:** Caída de facturación")).toMatchObject({
      label: "Riesgo",
      tone: "danger",
      rest: "Caída de facturación",
    });
  });
  it("Oportunidad → ok · Brecha → warn", () => {
    expect(detectLabel("Oportunidad: comercializar m²")?.tone).toBe("ok");
    expect(detectLabel("Brecha: falta fuente de caja chica")?.tone).toBe("warn");
  });
  it("texto normal → null (no fuerza badge)", () => {
    expect(detectLabel("Existen 16 documentos vencidos")).toBeNull();
  });
  it("negrita que envuelve TODA la línea: **Riesgo 1: X** → rest sin '**'", () => {
    const r = detectLabel("**Riesgo 1: Caída de facturación**");
    expect(r?.label).toBe("Riesgo");
    expect(r?.rest).toBe("Caída de facturación");
    expect(r?.rest.includes("*")).toBe(false); // ningún asterisco crudo
  });
});

describe("parseBlocks · estructura del briefing (sin markdown crudo)", () => {
  it("clasifica encabezados, subtítulos, listas, tabla, labels y párrafos", () => {
    const md = [
      "## Top 5 riesgos",
      "",
      "Estado por área:",
      "- **Riesgo 1:** Caída de facturación",
      "- Cliente en riesgo",
      "",
      "1. Priorizar renovaciones",
      "2. Revisar caja",
      "",
      "**Evidencia:** 16 documentos",
      "",
      "| Área | Estado |",
      "| --- | --- |",
      "| Facturación | ok |",
    ].join("\n");
    const blocks = parseBlocks(md);
    const types = blocks.map((b) => b.type);
    expect(types).toContain("h2");
    expect(types).toContain("h3"); // "Estado por área:" → subtítulo
    expect(types).toContain("ul");
    expect(types).toContain("ol");
    expect(types).toContain("label"); // "**Evidencia:** …"
    expect(types).toContain("table");
    // invariante DURO: ningún bloque de texto conserva '**' crudo
    const raw = JSON.stringify(blocks);
    expect(raw.includes("**")).toBe(false);
  });

  it("líneas de texto consecutivas NO se aplastan con markdown crudo", () => {
    const blocks = parseBlocks("Resumen: la caja alcanza.\n**Riesgo:** liquidez ajustada.");
    const label = blocks.find((b) => b.type === "label");
    expect(label).toMatchObject({ label: "Riesgo" });
  });
});

describe("sanitizeHref · sin XSS", () => {
  it("permite https/http/interno; bloquea javascript: y data:", () => {
    expect(sanitizeHref("https://x.com")).toBe("https://x.com");
    expect(sanitizeHref("/comercial/contratos")).toBe("/comercial/contratos");
    expect(sanitizeHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeHref("data:text/html,<script>")).toBeNull();
  });
});

// ── Round 16 · briefing por secciones semánticas + risk cards ────────────────
describe("sectionKindOf · secciones semánticas", () => {
  it("clasifica resumen/recomendaciones/brechas/fuentes; el resto es 'section'", () => {
    expect(sectionKindOf("Resumen ejecutivo")).toBe("summary");
    expect(sectionKindOf("Recomendaciones comerciales")).toBe("recommendations");
    expect(sectionKindOf("Brechas de datos")).toBe("gaps");
    expect(sectionKindOf("Fuentes")).toBe("sources");
    expect(sectionKindOf("Análisis adicional")).toBe("section");
  });
});

describe("groupSections · título premium + cajas temáticas", () => {
  it("agrupa por sección: title → summary → recommendations → gaps", () => {
    const md =
      "## Facturación por unidad\n\nResumen ejecutivo:\nANMAT lidera con 60%.\n\nRecomendaciones:\n- Priorizar ANMAT\n\nBrechas de datos:\nFalta clasificar 12%.";
    const secs = groupSections(parseBlocks(md));
    expect(secs.map((s) => s.variant)).toEqual(["title", "summary", "recommendations", "gaps"]);
    expect(secs[0].title).toBe("Facturación por unidad");
  });
  it("sin headings → una sola sección 'lead' (no rompe prosa plana)", () => {
    const secs = groupSections(parseBlocks("La caja alcanza para 30 días."));
    expect(secs).toHaveLength(1);
    expect(secs[0].variant).toBe("lead");
  });
  it("un Riesgo tras el resumen abre su propia sección (card fuera de la caja)", () => {
    const md = "## Top 5 riesgos\n\nResumen ejecutivo:\nHay 2 focos.\n\n**Riesgo 1: Caída**\n**Impacto:** Alto";
    const secs = groupSections(parseBlocks(md));
    expect(secs.map((s) => s.variant)).toEqual(["title", "summary", "section"]);
    expect(secs[1].blocks.every((b) => b.type !== "label")).toBe(true); // el riesgo no quedó en el summary
  });
});

describe("groupEntityCards · risk/opportunity cards", () => {
  it("agrupa Riesgo + atributos consecutivos en UNA card", () => {
    const md =
      "**Riesgo 1: Caída de facturación**\n**Impacto:** Alto\n**Urgencia:** Alta\n**Evidencia:** Cayó 18% [S1]\n**Acción recomendada:** Revisar con Comercial.";
    const grouped = groupEntityCards(parseBlocks(md));
    expect(grouped).toHaveLength(1);
    const card = grouped[0] as EntityCard;
    expect(card.type).toBe("card");
    expect(card.tone).toBe("danger");
    expect(card.fields.map((f) => f.label)).toEqual([
      "Impacto",
      "Urgencia",
      "Evidencia",
      "Acción recomendada",
    ]);
  });
  it("un bloque no-etiqueta cierra la card", () => {
    const grouped = groupEntityCards(parseBlocks("**Riesgo: X**\n**Impacto:** Alto\n\nOtro párrafo."));
    expect(grouped[0]).toMatchObject({ type: "card" });
    expect(grouped[grouped.length - 1]).toMatchObject({ type: "p" });
  });
});
