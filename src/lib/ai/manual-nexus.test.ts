// C1.5 · Manual Nexus / Ayuda Interna: las preguntas de "cómo usar Nexus"
// rutean a la capa manual_nexus (Drive→KB, mig 0186) — no a datos internos,
// institucional, general ni al fallback "manual no ingerido".

import { describe, expect, it } from "vitest";
import { getManualNexusSection } from "./copilot-suggestions";
import { classifyCopilotIntent } from "./intent-classifier";
import { TOOLS } from "./tools";

describe("C1.5 · routing de ayuda interna → manual_nexus", () => {
  const manual = [
    "¿Cómo creo una Orden de Compra?",
    "¿Cómo creo una Orden de Servicio?",
    "¿Cómo uso el módulo de Facturación?",
    "¿Qué módulos tiene Nexus?",
    "¿Dónde encuentro Compliance Cockpit?",
    "¿Qué puede ver un usuario de Operaciones?",
    "¿Cuál es el orden recomendado de lectura?",
    "¿Cómo reporto un error?",
    "¿Qué es WMS / Depósito?",
    "¿Qué hace Comercial y CRM?",
    "¿Qué permisos tiene cada rol?",
    "¿Cómo se conectan los módulos de Nexus?",
  ];
  for (const q of manual) {
    it(`"${q}" → manual_nexus`, () => {
      expect(classifyCopilotIntent(q).tipo).toBe("manual_nexus");
    });
  }
  it("NO hijackea datos internos, institucional ni navegación", () => {
    expect(classifyCopilotIntent("¿Cuánto facturamos el último mes?").tipo).toBe("nexus_internal");
    expect(classifyCopilotIntent("¿Qué servicios ofrece Logística TOPS?").tipo).toBe(
      "company_institutional"
    );
    expect(classifyCopilotIntent("¿Dónde veo las órdenes de compra?").tipo).not.toBe("manual_nexus");
  });
});

describe("C1.5 · Manual Nexus ya no es preview (ingerido, responde en vivo)", () => {
  it("la sección Manual Nexus es 'supported' (el click va al motor, no al fallback)", () => {
    const s = getManualNexusSection();
    expect(s.coverage).toBe("supported");
    expect(s.prompts.every((p) => p.coverage === "supported")).toBe(true);
  });
  it("company_knowledge_search admite capa manual_nexus", () => {
    expect(TOOLS.company_knowledge_search.schema.safeParse({ query: "x", capa: "manual_nexus" }).success).toBe(
      true
    );
  });
});
