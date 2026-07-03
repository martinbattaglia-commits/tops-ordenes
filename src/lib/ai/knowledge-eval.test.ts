// F5.1-b.0.1 · Eval set de retrieval documental.
// El planner real es Gemini (no unit-determinista); este eval fija la clasificación
// del GUARD que decide ANSWERED vs NO_EVIDENCE para cada consulta obligatoria del
// handoff, y verifica que las tools nuevas quedan bajo el guard (entityType = ficha).
// El e2e con Gemini vivo es un smoke DRAFT/PROD, fuera de este unit test.

import { describe, expect, it } from "vitest";
import { isMetadataContentRisk, METADATA_CARD_ENTITY_TYPES } from "./guardrails";
import { TOOLS } from "./tools";
import { MOCK_TOOL_ROWS } from "./mock";

const ficha = (t: "compliance_documento" | "contrato") => ({ entityType: t });

describe("F5.1-b.0.1 · eval set — metadata SE RESPONDE (guard no degrada)", () => {
  const cases: Array<[string, "compliance_documento" | "contrato"]> = [
    ["buscame documentos de compliance", "compliance_documento"],
    ["qué documentos de compliance hay de MAGALDI", "compliance_documento"],
    ["buscame contratos", "contrato"],
    ["qué contratos existen", "contrato"],
    ["qué contratos están próximos a vencer", "contrato"],
    ["cuál fue el último contrato firmado", "contrato"],
    ["cuál fue el último contrato de ANMAT firmado", "contrato"],
  ];
  it.each(cases)("responde (no degrada): %s", (q, t) => {
    expect(isMetadataContentRisk(q, [ficha(t)])).toBe(false);
  });
});

describe("F5.1-b.0.1 · eval set — CONTENIDO degrada a NO_EVIDENCE (sin texto extraído)", () => {
  const cases = [
    "resumime el contenido del contrato X",
    "qué cláusulas tiene el contrato X",
    "qué obligaciones asumimos según el contrato X",
  ];
  it.each(cases)("degrada a NO_EVIDENCE: %s", (q) => {
    expect(isMetadataContentRisk(q, [ficha("contrato")])).toBe(true);
  });
});

describe("F5.1-b.0.1 · las tools nuevas quedan bajo el guard (defensa metadata-vs-contenido)", () => {
  it("contracts_overview → ficha 'contrato'", () => {
    const chunk = TOOLS.contracts_overview.rowToChunk(MOCK_TOOL_ROWS.contracts_overview[0]);
    expect(METADATA_CARD_ENTITY_TYPES.has(chunk.entityType)).toBe(true);
  });
  it("docs_browse → ficha documental (compliance/contrato)", () => {
    const chunk = TOOLS.docs_browse.rowToChunk(MOCK_TOOL_ROWS.docs_browse[0]);
    expect(METADATA_CARD_ENTITY_TYPES.has(chunk.entityType)).toBe(true);
  });
});
