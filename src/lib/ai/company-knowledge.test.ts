// C1 · Capa 2 institucional (conocimiento de Logística TOPS) — tests RED/GREEN.
// Diseño: tabla company_knowledge_documents + RPC ai_company_knowledge_search
// (INVOKER), tool `company_knowledge_search`. El engine intenta la tool para
// intención company_institutional; si NO hay documentos ingestados (fixture/RPC
// vacío → migración 0185 sin aplicar), cae a la brecha ESPECÍFICA (coverage),
// nunca a search_knowledge genérico ni a "no encontré en Nexus".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOLS } from "./tools";
import { classifyCopilotIntent } from "./intent-classifier";
import { TOOL_VISUALS } from "./visuals";

const SESSION = "11111111-1111-4111-8111-111111111111";

async function loadEngine() {
  const mod = await import("./engine");
  const guards = await import("./guardrails");
  return { askCopilot: mod.askCopilot, NO_EVIDENCE: guards.NO_EVIDENCE };
}

const baseReq = (question: string) => ({
  sessionId: SESSION,
  question,
  history: [],
  channel: "page" as const,
});

// Fixture institucional para probar el filtrado de estados (lo que la RPC hace en
// SQL, el demoFilter lo espeja en demo/tests).
const FIXTURE = [
  {
    title: "Servicios de Logística TOPS",
    source_type: "SITE_COMPLETO",
    business_unit: "CORPORATIVO",
    capa: "institucional",
    estado: "VIGENTE",
    ingestable: true,
    url: "https://logisticatops.com",
    summary:
      "Logística TOPS ofrece almacenamiento regulado ANMAT, cargas generales y distribución 3PL en AMBA.",
  },
  {
    title: "Servicios TOPS (versión histórica 2023)",
    source_type: "SITE_COMPLETO",
    business_unit: "CORPORATIVO",
    capa: "institucional",
    estado: "HISTORICO",
    ingestable: true,
    url: "https://logisticatops.com/2023",
    summary: "Versión antigua del listado de servicios — no debe usarse como vigente.",
  },
  {
    title: "Borrador interno de propuesta regulados",
    source_type: "PROPUESTA_MODELO",
    business_unit: "REGULADOS",
    capa: "institucional",
    estado: "NO_INGESTAR",
    ingestable: false,
    url: "",
    summary: "Documento marcado NO_INGESTAR: jamás debe entrar al índice consultable.",
  },
];

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("AI_PROVIDER", "mock");
  vi.stubEnv("AI_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("./mock");
});

// ── Catálogo ─────────────────────────────────────────────────────────────────
describe("C1 · tool company_knowledge_search en el catálogo", () => {
  it("la tool existe y es una RPC INVOKER (no LOCAL ni orquestadora)", () => {
    const spec = TOOLS.company_knowledge_search;
    expect(spec, "company_knowledge_search debe existir en TOOLS").toBeDefined();
    expect(spec.rpc).toBe("ai_company_knowledge_search");
    expect(spec.orchestrate).toBeUndefined();
  });
});

// ── Filtrado de estados (Fase F 5/6/7) — el demoFilter espeja la RPC ──────────
describe("C1 · filtrado de estados (VIGENTE prioritario; NO_INGESTAR/HISTORICO fuera)", () => {
  it("query 'servicios' → SOLO el documento VIGENTE (Fase F 4/7)", () => {
    const out = TOOLS.company_knowledge_search.demoFilter!(FIXTURE, { query: "servicios" });
    expect(out).toHaveLength(1);
    expect(out[0].estado).toBe("VIGENTE");
    expect(String(out[0].title)).toMatch(/Servicios de Log/i);
  });

  it("NO_INGESTAR nunca aparece (Fase F 5)", () => {
    const out = TOOLS.company_knowledge_search.demoFilter!(FIXTURE, { query: "propuesta regulados" });
    expect(out.some((r) => r.estado === "NO_INGESTAR")).toBe(false);
    expect(out).toHaveLength(0);
  });

  it("HISTORICO no se usa como vigente (Fase F 6)", () => {
    const out = TOOLS.company_knowledge_search.demoFilter!(FIXTURE, { query: "servicios" });
    expect(out.some((r) => r.estado === "HISTORICO")).toBe(false);
  });

  it("rowToChunk cita el documento institucional con su URL real (Fase F 4)", () => {
    const chunk = TOOLS.company_knowledge_search.rowToChunk(FIXTURE[0]);
    expect(chunk.entityType).toBe("institucional");
    expect(chunk.title).toMatch(/Servicios/i);
    expect(chunk.url).toBe("https://logisticatops.com");
  });
});

// ── Engine: intención institucional ──────────────────────────────────────────
describe("C1 · engine · intención institucional", () => {
  it("CON documentos ingestados → responde DESDE company_knowledge (Fase F 4)", async () => {
    // Inyecta el fixture como si hubiera documentos ingestados (RPC con filas).
    vi.doMock("./mock", async (orig) => {
      const actual = await orig<typeof import("./mock")>();
      return {
        ...actual,
        MOCK_TOOL_ROWS: { ...actual.MOCK_TOOL_ROWS, company_knowledge_search: FIXTURE },
      };
    });
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué servicios ofrece Logística TOPS?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.some((s) => s.tool === "company_knowledge_search")).toBe(true);
    // Nunca la búsqueda genérica del spine (Fase F 1).
    expect(res.sources.some((s) => s.tool === "search_knowledge")).toBe(false);
  });

  it("SIN documentos ingestados → brecha específica, no 'no encontré en Nexus' (Fase F 2/3)", async () => {
    const { askCopilot, NO_EVIDENCE } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué servicios ofrece Logística TOPS para ANMAT?"));
    expect(res.outcome).toBe("answered");
    expect(res.answer).not.toBe(NO_EVIDENCE);
    expect(res.answer.toLowerCase()).not.toMatch(/no\s+tengo\s+evidencia.*nexus/);
    // La brecha institucional es la respuesta honesta (coverage), NUNCA search_knowledge.
    expect(res.sources.some((s) => s.tool === "search_knowledge")).toBe(false);
    expect(res.answer.toLowerCase()).toMatch(/institucional|ingest/);
  });
});

// ── Regresión: las otras capas siguen intactas (Fase F 8/9/10) ───────────────
describe("C1 · regresión de capas (no romper Nexus / general / brief)", () => {
  it("pregunta Nexus (incidentes) sigue en Capa 1, NO company_knowledge (Fase F 8)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿cuántos incidentes abiertos hay?"));
    expect(res.sources.some((s) => s.tool === "company_knowledge_search")).toBe(false);
    expect(res.sources.some((s) => s.tool === "incidents_overview")).toBe(true);
  });

  it("pregunta general (fecha) sigue en Capa 4, NO company_knowledge (Fase F 9)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿qué día es hoy?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.some((s) => s.tool === "company_knowledge_search")).toBe(false);
    expect(res.sources.some((s) => s.tool === "general_context")).toBe(true);
  });

  it("management brief sigue funcionando (Fase F 10)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(
      baseReq("Haceme un resumen ejecutivo de Nexus para la reunión de dirección")
    );
    expect(res.outcome).toBe("answered");
    expect(res.sources.some((s) => s.tool === "management_brief")).toBe(true);
  });
});

// ── Fix B (post-smoke 2026-07-07): ruteo institucional de productos/unidades ──
describe("C1 fix · ruteo: productos/unidades TOPS → company_institutional", () => {
  it("'¿Qué es TOPS Nexus?' → company_institutional (NO nexus_internal por el veto)", () => {
    expect(classifyCopilotIntent("¿Qué es TOPS Nexus?").tipo).toBe("company_institutional");
  });
  it("'¿Qué es TOPS Connect?' → company_institutional (NO general_static)", () => {
    expect(classifyCopilotIntent("¿Qué es TOPS Connect?").tipo).toBe("company_institutional");
  });
  it("'¿Qué diferencia hay entre ANMAT y Cargas Generales?' → company_institutional", () => {
    expect(classifyCopilotIntent("¿Qué diferencia hay entre ANMAT y Cargas Generales?").tipo).toBe(
      "company_institutional"
    );
  });
  it("'¿Dónde opera Logística TOPS?' → company_institutional", () => {
    expect(classifyCopilotIntent("¿Dónde opera Logística TOPS?").tipo).toBe("company_institutional");
  });
  // Regresiones: no romper el ruteo existente.
  it("regresión: '¿Qué es ANMAT?' sigue general_static (el organismo, no TOPS)", () => {
    expect(classifyCopilotIntent("¿Qué es ANMAT?").tipo).toBe("general_static");
  });
  it("regresión: '¿cuánto facturamos este mes?' sigue nexus_internal (veto)", () => {
    expect(classifyCopilotIntent("¿cuánto facturamos este mes?").tipo).toBe("nexus_internal");
  });
  it("regresión: 'diferencia entre gasto y presupuesto' NO es institucional", () => {
    expect(
      classifyCopilotIntent("¿cuál es la diferencia entre gasto y presupuesto?").tipo
    ).not.toBe("company_institutional");
  });
});

// ── Capa visual institucional v2 (UX 2026-07-07: ejecutivo, cards por área, ────
//    NO tabla documental al inicio; fuentes van a la sección colapsable) ────────
describe("C1 · capa visual de company_knowledge_search (cards por unidad, sin tabla)", () => {
  const rows = [
    { title: "Depósito habilitado ANMAT en Barracas (sitio)", business_unit: "REGULADOS", source_type: "SITE_COMPLETO", url: "https://logisticatops.com/anmat", estado: "VIGENTE", summary: "Depósito habilitado audit-ready, cubículos llave en mano, documentación para el RNE del cliente." },
    { title: "Cargas Generales — Almacenamiento 3PL", business_unit: "CARGAS_GENERALES", source_type: "SITE_COMPLETO", url: "https://cargasgenerales.logisticatops.com", estado: "VIGENTE", summary: "Almacenamiento de cargas generales, racks, WMS." },
    { title: "Carpeta institucional", business_unit: "CORPORATIVO", source_type: "DOSSIER", url: "", estado: "VIGENTE", summary: "Dossier institucional 2026." },
  ];
  it("existe adaptador visual para company_knowledge_search", () => {
    expect(TOOL_VISUALS.company_knowledge_search).toBeDefined();
  });
  it("produce cards por UNIDAD de negocio (link real) y SIN tabla documental al inicio (#4)", () => {
    const v = TOOL_VISUALS.company_knowledge_search!(rows, {});
    expect(v).not.toBeNull();
    expect(v!.table).toBeNull(); // no big table at start
    expect(v!.kpis!.length).toBeGreaterThanOrEqual(2);
    expect(v!.kpis!.some((k) => k.url === "https://logisticatops.com/anmat")).toBe(true); // link REAL
  });
  it("no inventa links: unidad sin URL → card sin url", () => {
    const v = TOOL_VISUALS.company_knowledge_search!(rows, {});
    expect(v!.kpis!.some((k) => !k.url)).toBe(true); // la card CORPORATIVO (dossier) no tiene URL
  });
  it("una card por unidad (no una por documento): máximo 4 cards", () => {
    const v = TOOL_VISUALS.company_knowledge_search!(rows, {});
    expect(v!.kpis!.length).toBeLessThanOrEqual(4);
  });
  it("sin filas → sin tablero (null; no se maquilla el vacío)", () => {
    expect(TOOL_VISUALS.company_knowledge_search!([], {})).toBeNull();
  });
});
