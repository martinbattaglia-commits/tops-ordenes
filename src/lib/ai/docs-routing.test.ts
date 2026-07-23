// FIX Drive Docs (2026-07-08): planchetas/planos Magaldi-Luján. Root cause F
// (routing): el router no mandaba "planos" (plural) / evacuación / habilitante a
// docs_browse, y pasaba solo la SEDE como query (128 docs por fecha → plancheta
// sepultada). Fix: detectar TIPO documental (canónico) + SEDE y armar query
// precisa "tipo sede" (AND del tsv). Root cause D: el chunk citaba la nav al
// módulo en vez del link REAL de Drive (source_url del enrich).

import { describe, expect, it } from "vitest";
import { pickTools } from "./providers/mock";
import { TOOLS } from "./tools";

describe("FIX Drive Docs · routing a docs_browse con query precisa (tipo + sede)", () => {
  const cases: Array<[string, string]> = [
    ["Mostrame la plancheta de habilitación de Luján", "habilitacion lujan"],
    ["Mostrame la plancheta de habilitación de Magaldi", "habilitacion magaldi"],
    ["Abrí los planos de Magaldi", "plano magaldi"],
    ["Abrí los planos de Luján", "plano lujan"],
    ["Plano de incendio de Magaldi", "incendio magaldi"],
    ["Plano de evacuación de Luján", "evacuacion lujan"],
    ["Documentación habilitante de Pedro de Luján 3159", "habilitacion lujan"],
    ["Documentación habilitante de Agustín Magaldi 1765", "habilitacion magaldi"],
  ];
  for (const [question, expected] of cases) {
    it(`"${question}" → docs_browse "${expected}"`, () => {
      const calls = pickTools(question);
      expect(calls[0]?.tool, `${question}: no ruteó a docs_browse`).toBe("docs_browse");
      expect(String(calls[0]?.args.query ?? ""), question).toBe(expected);
      expect(calls[0]?.args.tipo).toBe("compliance");
    });
  }
});

describe("FIX Drive Docs · el chunk expone el link REAL de Drive (root cause D)", () => {
  it("rowToChunk usa source_url (el PDF de Drive), no la nav al módulo", () => {
    const chunk = TOOLS.docs_browse.rowToChunk({
      entity_type: "compliance_documento",
      entity_id: "abc",
      public_id: "CMP#1",
      title: "14. PLANCHETA HABILITACION MAGALDI 1765.pdf",
      excerpt: "",
      entity_date: null,
      source_url: "https://drive.google.com/file/d/xyz/view",
    });
    expect(chunk.url).toBe("https://drive.google.com/file/d/xyz/view");
  });
  it("sin source_url → fallback honesto a la ficha del módulo (no rompe)", () => {
    const chunk = TOOLS.docs_browse.rowToChunk({
      entity_type: "compliance_documento",
      entity_id: "abc",
      public_id: "CMP#1",
      title: "X",
      excerpt: "",
      entity_date: null,
    });
    expect(chunk.url).toBe("/anmat");
  });
});

// FASE 2 (2026-07-08): el usuario final quiere el PDF/plancheta, no el .dwg.
describe("FIX Drive Docs · ranking plancheta/habilitación (PDF visible > CAD técnico)", () => {
  const rank = (rows: Array<Record<string, unknown>>, query: string) =>
    TOOLS.docs_browse.rank!(rows, { query });

  it("intención plancheta/habilitación: PDF plancheta primero, .dwg último", () => {
    const rows = [
      { title: "verotin lujan plano de habilitacion 23 de Mayo 2018.dwg", source_url: "u1" },
      { title: "Habilitación Luján .pdf", source_url: "u2" },
      { title: "PLANCHETA DE HABILITACIÓN LUJAN.pdf", source_url: "u3" },
    ];
    const ranked = rank(rows, "habilitacion lujan");
    expect(String(ranked[0].title)).toContain("PLANCHETA");
    expect(String(ranked[ranked.length - 1].title).toLowerCase()).toContain(".dwg");
  });

  it("Magaldi: '14. PLANCHETA HABILITACION MAGALDI 1765.pdf' como principal", () => {
    const rows = [
      { title: "Habilitacion Magaldi Certificada.pdf" },
      { title: "AGUSTIN MAGALDI 1765_ INCENDIO.dwg" },
      { title: "14. PLANCHETA HABILITACION MAGALDI 1765.pdf" },
    ];
    const ranked = rank(rows, "habilitacion magaldi");
    expect(String(ranked[0].title)).toContain("PLANCHETA HABILITACION MAGALDI");
  });

  it("intención plano TÉCNICO (incendio): NO reordena — el CAD puede ser principal", () => {
    const rows = [{ title: "AGUSTIN MAGALDI 1765_ INCENDIO.dwg" }, { title: "otro.pdf" }];
    const ranked = rank(rows, "incendio magaldi");
    expect(String(ranked[0].title).toLowerCase()).toContain(".dwg");
  });
});
