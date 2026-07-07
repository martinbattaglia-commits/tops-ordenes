// F5.2-lite · Tests E2E del engine con provider mock y demo mode (sin DB).
// env se evalúa al importar → vi.stubEnv + resetModules + import dinámico.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = "11111111-1111-4111-8111-111111111111";

async function loadEngine() {
  const mod = await import("./engine");
  const guards = await import("./guardrails");
  return { askCopilot: mod.askCopilot, NO_EVIDENCE: guards.NO_EVIDENCE };
}

function baseReq(question: string) {
  return {
    sessionId: SESSION,
    question,
    history: [],
    channel: "page" as const,
  };
}

beforeEach(() => {
  vi.resetModules();
  // Demo mode real: sin Supabase env → isMock() true (no toca DB ni red).
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("AI_PROVIDER", "mock");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("kill-switch AI_ENABLED (fail-closed, D-F5-8)", () => {
  it("sin AI_ENABLED → outcome killed, cero trabajo", async () => {
    vi.stubEnv("AI_ENABLED", "");
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿incidentes abiertos?"));
    expect(res.outcome).toBe("killed");
    expect(res.sources).toEqual([]);
  });
  it("AI_ENABLED=0 → killed (solo '1' habilita)", async () => {
    vi.stubEnv("AI_ENABLED", "0");
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("hola"));
    expect(res.outcome).toBe("killed");
  });
});

describe("flujo completo en demo mode (provider mock + fixtures)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("pregunta del piloto → answered con citas válidas y fuentes", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué incidentes críticos están abiertos?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBeGreaterThan(0);
    expect(res.answer).toMatch(/\[S\d+\]/);
    // El disclaimer de verificación cierra la respuesta compuesta.
    expect(res.answer).toContain("Verificá el detalle en las fuentes");
  });

  it("las 10 preguntas objetivo del piloto responden sin error", async () => {
    const { askCopilot, NO_EVIDENCE } = await loadEngine();
    const preguntas = [
      "¿Qué incidentes críticos están abiertos?",
      "¿Qué tareas están vencidas?",
      "¿Qué pasó hoy en operaciones?",
      "¿Qué clientes tienen más problemas?",
      "¿Qué tareas dependen de José Luis?",
      "Resumime el estado del depósito",
      "¿Qué documentos Compliance están pendientes?",
      "¿Qué workflow está trabado?",
      "¿Qué debería mirar primero mañana?",
      "¿Qué pasó con el incidente INC-2026-0001?",
    ];
    for (const q of preguntas) {
      const res = await askCopilot(baseReq(q));
      expect(["answered", "no_evidence"], q).toContain(res.outcome);
      if (res.outcome === "answered") {
        expect(res.answer, q).toMatch(/\[S\d+\]/);
      } else {
        expect(res.answer, q).toBe(NO_EVIDENCE);
      }
    }
  });

  it("pregunta vacía/mínima → NO_EVIDENCE exacto", async () => {
    const { askCopilot, NO_EVIDENCE } = await loadEngine();
    const res = await askCopilot(baseReq("?"));
    expect(res.outcome).toBe("no_evidence");
    expect(res.answer).toBe(NO_EVIDENCE);
  });

  it("respuesta VACÍA del modelo (answered vacío) → degrada a NO_EVIDENCE (F5.1-b.0.1.1)", async () => {
    // El sentinel del MockProvider fuerza un 'final' vacío (simula el fallo del smoke
    // b.0.1: Gemini devolvió answered vacío sin tools ni fuentes). El engine no debe
    // dejarlo pasar como answered.
    const { askCopilot, NO_EVIDENCE } = await loadEngine();
    const res = await askCopilot(baseReq("__force_empty_answer__"));
    expect(res.outcome).toBe("no_evidence");
    expect(res.answer).toBe(NO_EVIDENCE);
    expect(res.sources).toEqual([]);
  });

  it("respuesta VACÍA DESPUÉS de recuperar chunks (round 2) → NO_EVIDENCE (F5.1-b.0.1.1)", async () => {
    // Cubre el gap del review: empty-answer con chunks>0 (reintento incluido) también degrada,
    // y el guard de vacío corre ANTES que isMetadataContentRisk (outcome nunca queda 'answered').
    const { askCopilot, NO_EVIDENCE } = await loadEngine();
    const res = await askCopilot(baseReq("__empty_after_tools__"));
    expect(res.outcome).toBe("no_evidence");
    expect(res.answer).toBe(NO_EVIDENCE);
  });

  it("ruteo a docs_browse (archivos de compliance) → answered con fuentes (F5.1-b.0.1.1)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("cuáles son los archivos de compliance"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBeGreaterThan(0);
  });

  it("ruteo a contracts_overview (contratos por vencer) → answered con fuentes (F5.1-b.0.1.1)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("qué contratos están próximos a vencer"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBeGreaterThan(0);
  });

  it("PII embebida en fixtures/citas queda redactada en la respuesta", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué incidentes críticos están abiertos?"));
    // Ningún patrón de CUIT/CBU/email debería sobrevivir en la respuesta.
    expect(res.answer).not.toMatch(/\b\d{2}-\d{8}-\d\b/);
    expect(res.answer).not.toMatch(/\b[\w.+-]+@[\w-]+\.\w{2,}\b/);
  });
});

describe("P1a · vacío honesto: tool corrió y devolvió 0 filas (fix/f5-2)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("incidents_overview sin filas → mensaje de dominio, NO el fallback genérico", async () => {
    // Fuerza la heladera vacía en demo: incidents_overview no devuelve filas.
    // Reproduce el caso real de prod (0 incidentes críticos abiertos → NO_EVIDENCE
    // engañoso). El engine debe distinguir "no hay registros" de "no puedo".
    vi.doMock("./mock", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./mock")>();
      return {
        ...actual,
        MOCK_TOOL_ROWS: { ...actual.MOCK_TOOL_ROWS, incidents_overview: [] },
      };
    });
    const { askCopilot, NO_EVIDENCE } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué incidentes críticos están abiertos?"));
    expect(res.outcome).toBe("no_evidence");
    expect(res.answer).not.toBe(NO_EVIDENCE);
    expect(res.answer.toLowerCase()).toContain("incidente");
    expect(res.sources).toEqual([]);
    vi.doUnmock("./mock");
  });
});

describe("P2 · dominios financieros ahora responden (fix/f5-2)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("'última factura emitida' → answered con fuente a /billing", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuál fue la última factura emitida?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBeGreaterThan(0);
    expect(res.sources[0].entityType).toBe("customer_invoice");
    expect(res.sources[0].url).toBe("/billing");
    expect(res.answer).toMatch(/\[S\d+\]/);
  });

  it("'última orden de compra' → answered con fuente a /compras/ordenes", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuál fue la última orden de compra emitida?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("purchase_order");
    expect(res.sources[0].url).toBe("/compras/ordenes");
  });

  it("'último proveedor cargado' → answered con fuente a /compras/proveedores", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuál fue el último proveedor cargado?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("supplier");
    expect(res.sources[0].url).toBe("/compras/proveedores");
  });
});

describe("Organigrama · el Copilot ahora responde jerarquía (fix/f5-2)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("'¿quién es el presidente?' → answered, cita al presidente con fuente /organigrama", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Quién es el presidente de Logística TOPS?"));
    expect(res.outcome).toBe("answered");
    expect(res.answer).toMatch(/Battaglia/);
    expect(res.answer).toMatch(/\[S\d+\]/);
    expect(res.sources[0].entityType).toBe("organization_member");
    expect(res.sources[0].url).toBe("/organigrama");
  });

  it("vicepresidente / comercial / operaciones / organigrama → answered (no empty state)", async () => {
    const { askCopilot } = await loadEngine();
    for (const q of [
      "¿Quién es el vicepresidente?",
      "¿Quién está a cargo de comercial?",
      "¿Quién está a cargo de operaciones?",
      "Mostrame el organigrama de Logística TOPS",
    ]) {
      const res = await askCopilot(baseReq(q));
      expect(res.outcome, q).toBe("answered");
      expect(res.sources.length, q).toBeGreaterThan(0);
    }
  });

  it("no expone emails en la respuesta del organigrama (PII)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("Mostrame el organigrama de Logística TOPS"));
    expect(res.answer).not.toMatch(/@logisticatops\.com/i);
  });
});

describe("Analytics · totales/saldos/rankings responden con agregado, no listado (fix/f5-2)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("'¿Cuánto se facturó el último mes?' → answered con billing_periodo → /billing", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuánto se facturó el último mes?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("billing_periodo");
    expect(res.sources[0].url).toBe("/billing");
  });

  it("'¿Cuánta plata hay en el banco Santander?' → answered con bank_balance → /tesoreria/bancos", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuánta plata hay en el banco Santander?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("bank_balance");
    expect(res.sources[0].url).toBe("/tesoreria/bancos");
  });

  it("'¿Cuál es el proveedor que más consume presupuesto?' → supplier_spend, NO catálogo", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuál es el proveedor que más consume presupuesto?"));
    expect(res.outcome).toBe("answered");
    // La pregunta pide agregación: la fuente debe ser supplier_spend, no 'supplier'.
    expect(res.sources[0].entityType).toBe("supplier_spend");
  });

  it("routing regression: catálogo vs agregado no se pisan", async () => {
    const { askCopilot } = await loadEngine();
    const cat = await askCopilot(baseReq("¿Cuál fue el último proveedor cargado?"));
    expect(cat.sources[0].entityType).toBe("supplier"); // catálogo sigue en suppliers_overview
    const fact = await askCopilot(baseReq("¿Cuál fue la última factura emitida?"));
    expect(fact.sources[0].entityType).toBe("customer_invoice"); // P2 intacto
  });
});

describe("Navegación · '¿dónde veo X?' responde con la sección real (fix/f5-2)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("'¿Dónde veo las órdenes de compra?' → nexus_section → /compras/ordenes", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Dónde veo las órdenes de compra?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("nexus_section");
    expect(res.sources[0].url).toBe("/compras/ordenes");
  });

  it("'¿Qué secciones tiene Nexus?' → answered con varias secciones", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué secciones tiene Nexus?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBeGreaterThan(3);
    expect(res.sources.every((s) => s.entityType === "nexus_section")).toBe(true);
  });
});

describe("P1b · resiliencia: un tool-call con args inválidos no rompe el turno (fix/f5-2)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("args inválidos del modelo → se saltea la call, outcome NO es 'error'", async () => {
    // Reproduce el crash real de prod: Gemini mandó limit>50 → todo el turno cayó
    // en 'error' ("Copilot no está disponible"). Con la resiliencia, una call mala
    // se saltea y el turno degrada limpio (no_evidence), nunca 'error'.
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("__bad_tool_args__"));
    expect(res.outcome).not.toBe("error");
    expect(["no_evidence", "answered"]).toContain(res.outcome);
  });
});

describe("presupuesto (D-F5-8)", () => {
  it("corta en el límite diario con outcome budget", async () => {
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("AI_LIMIT_REQUESTS_PER_DAY", "2");
    const { askCopilot } = await loadEngine();
    const q = baseReq("¿Qué tareas están vencidas?");
    expect((await askCopilot(q)).outcome).toBe("answered");
    expect((await askCopilot(q)).outcome).toBe("answered");
    const third = await askCopilot(q);
    expect(third.outcome).toBe("budget");
    expect(third.answer).toContain("límite");
  });
});

describe("providers reales sin key → inertes (D-F5-9 / decisión Gemini)", () => {
  it("AI_PROVIDER=gemini sin key → error controlado, cero red", async () => {
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿incidentes?"));
    expect(res.outcome).toBe("error");
    expect(res.sources).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("AI_PROVIDER=anthropic (secundario) sin key → error controlado", async () => {
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("AI_PROVIDER", "anthropic");
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿incidentes?"));
    expect(res.outcome).toBe("error");
    expect(res.sources).toEqual([]);
  });
});
