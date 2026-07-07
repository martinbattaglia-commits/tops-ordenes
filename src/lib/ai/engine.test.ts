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

describe("Intención de negocio · singular=top-1 vs ranking (smoke humano 2026-07-06)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("'¿Cuál es el proveedor que gastó más el mes pasado?' → UNA sola fuente supplier_spend", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuál es el proveedor que gastó más el mes pasado?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBe(1); // singular → top 1, no listado de 8
    expect(res.sources[0].entityType).toBe("supplier_spend");
  });

  it("'La respuesta es única… el proveedor que INSUMIÓ más el mes pasado' → supplier_spend top-1, NO catálogo", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(
      baseReq("La respuesta es única, decime solo el proveedor que insumió más el mes pasado.")
    );
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("supplier_spend"); // NUNCA 'supplier' (catálogo)
    expect(res.sources.length).toBe(1);
  });

  it("typo 'probador' en contexto de gasto → igual rutea a supplier_spend (no vacío)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(
      baseReq("¿Cuál es el probador que más gastó en el transcurso del mes pasado?")
    );
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("supplier_spend");
  });

  it("'ranking de proveedores por gasto' → VARIAS fuentes (ranking pedido)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("Hazme un ranking de proveedores en base a los consumos"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBeGreaterThan(1);
    expect(res.sources[0].entityType).toBe("supplier_spend");
  });
});

describe("Documento específico → docs_browse, NO compliance_pending (smoke humano)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("'¿Me das la plancheta de habilitación de Luján 3159?' → docs_browse con keyword de sede", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Me das la plancheta de habilitación de Luján 3159?"));
    expect(res.outcome).toBe("answered");
    // La tool correcta es la búsqueda documental, no la lista de vencidos.
    expect(res.sources[0].tool).toBe("docs_browse");
  });

  it("'¿Qué documentos de compliance están pendientes?' → sigue en compliance_pending (regresión)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué documentos de compliance están pendientes?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].tool).toBe("compliance_pending");
  });
});

describe("Cliente que más facturó · customer_revenue_overview (smoke humano)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("'¿Cuál fue el cliente que más facturó?' → top-1 con fuente /billing (no vacío)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuál fue el cliente que más facturó?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBe(1);
    expect(res.sources[0].entityType).toBe("customer_revenue");
    expect(res.sources[0].url).toBe("/billing");
  });

  it("'Ranking de clientes por facturación' → varias fuentes", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("Ranking de clientes por facturación"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBeGreaterThan(1);
    expect(res.sources[0].entityType).toBe("customer_revenue");
  });

  it("'¿Cuántos facturó este mes?' (sin 'se') → billing_summary (widening aprobado)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuántos facturó este mes?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("billing_periodo");
  });

  it("clientes piloto (TEST/QA en el nombre) computan NORMAL: sin filtro por nombre (decisión Dirección 2026-07-07)", async () => {
    // CLIENTE TEST QA TOPS es un cliente VÁLIDO de la etapa piloto. Si la base dice
    // que es el que más facturó, el Copilot lo responde. Solo excluyen los campos
    // estructurados (anulada / estado_arca), NUNCA el nombre. Este test blinda esa
    // decisión: un filtro anti-QA por nombre rompe la suite.
    vi.doMock("./mock", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./mock")>();
      return {
        ...actual,
        MOCK_TOOL_ROWS: {
          ...actual.MOCK_TOOL_ROWS,
          customer_revenue_overview: [
            {
              cliente: "CLIENTE TEST QA TOPS",
              total: "69213815.00",
              cantidad: 7,
              periodo: "todo",
              detalle:
                "Facturación por cliente · CLIENTE TEST QA TOPS · ARS 69,213,815.00 · 7 facturas autorizadas · período: todo",
            },
            {
              cliente: "Cliente Real Menor SA",
              total: "1000000.00",
              cantidad: 1,
              periodo: "todo",
              detalle: "Facturación por cliente · Cliente Real Menor SA · ARS 1,000,000.00",
            },
          ],
        },
      };
    });
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuál fue el cliente que más facturó?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBe(1); // singular → top 1
    expect(res.sources[0].title).toContain("CLIENTE TEST QA TOPS"); // el top real, sin censura
    expect(res.answer).toContain("CLIENTE TEST QA TOPS");
    vi.doUnmock("./mock");
  });
});

describe("Reportes gerenciales · ingresos por categoría (caso testigo ANMAT/Cargas)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("pregunta testigo completa → reporte por categoría con fuentes /billing (no vacío)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(
      baseReq(
        "Me podrías dar un reporte que esté hecho por categoría de los ingresos de este último mes, qué porcentaje fue asignado a ANMAT y qué porcentaje fue asignado a cargas generales"
      )
    );
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBeGreaterThan(1); // una fuente por categoría
    expect(res.sources.every((s) => s.entityType === "revenue_categoria")).toBe(true);
    expect(res.sources[0].url).toBe("/billing");
    expect(res.answer).toMatch(/%/); // porcentajes presentes (vienen de la tool)
    expect(res.answer).toMatch(/ANMAT/i);
  });

  it("'¿Qué porcentaje de ingresos fue ANMAT el último mes?' → report tool, no search_knowledge", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué porcentaje de ingresos fue ANMAT el último mes?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("revenue_categoria");
  });

  it("'Haceme un reporte ejecutivo de facturación del último mes' → report tool", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("Haceme un reporte ejecutivo de facturación del último mes"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("revenue_categoria");
  });

  it("'Mostrame distribución de ingresos por categoría' → report tool", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("Mostrame la distribución de ingresos por categoría"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("revenue_categoria");
  });

  it("'Sin clasificar' es VISIBLE cuando existe (nunca se oculta ni se inventa categoría)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(
      baseReq("Reporte de ingresos por categoría del último mes")
    );
    expect(res.outcome).toBe("answered");
    // El fixture demo incluye una fila 'Sin clasificar': debe llegar a la respuesta.
    expect(res.answer).toMatch(/sin clasificar/i);
  });

  it("regresión: 'cuánto se facturó' sigue en billing_summary y 'cliente que más facturó' en customer_revenue", async () => {
    const { askCopilot } = await loadEngine();
    const total = await askCopilot(baseReq("¿Cuánto se facturó el último mes?"));
    expect(total.sources[0].entityType).toBe("billing_periodo");
    const cliente = await askCopilot(baseReq("¿Cuál fue el cliente que más facturó?"));
    expect(cliente.sources[0].entityType).toBe("customer_revenue");
  });
});

describe("Capa visual · el engine adjunta un tablero DETERMINÍSTICO (estándar 2026-07-07)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("pregunta testigo → visual kind 'report' con KPIs, tabla, donut y warning Sin clasificar", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(
      baseReq("Reporte de ingresos por categoría del último mes: % ANMAT y % cargas generales")
    );
    expect(res.outcome).toBe("answered");
    expect(res.visual).toBeTruthy();
    expect(res.visual!.kind).toBe("report");
    expect(res.visual!.chart!.type).toBe("donut");
    expect(res.visual!.chart!.labels).toContain("ANMAT");
    expect(res.visual!.kpis!.length).toBeGreaterThanOrEqual(2);
    expect(res.visual!.warnings!.join(" ").toLowerCase()).toContain("sin clasificar");
  });

  it("'Ranking de clientes por facturación' → visual ranking con barras", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("Ranking de clientes por facturación"));
    expect(res.visual!.kind).toBe("ranking");
    expect(res.visual!.chart!.type).toBe("bar");
    expect(res.visual!.table!.rows.length).toBeGreaterThan(1);
  });

  it("'¿Cuál fue el cliente que más facturó?' → visual kpi COMPACTO (singular)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuál fue el cliente que más facturó?"));
    expect(res.visual!.kind).toBe("kpi");
  });

  it("'¿Cuánta plata hay en el banco Santander?' → visual con KPI de saldo", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuánta plata hay en el banco Santander?"));
    expect(res.visual).toBeTruthy();
    expect(res.visual!.kpis!.length).toBeGreaterThan(0);
  });

  it("preguntas simples (presidente) → SIN tablero (respuesta compacta, visual null)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Quién es el presidente de Logística TOPS?"));
    expect(res.outcome).toBe("answered");
    expect(res.visual ?? null).toBeNull();
  });

  it("no_evidence → nunca hay tablero (no se maquilla el vacío)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("que saldo tiene la cuenta de marte?"));
    if (res.outcome !== "answered") expect(res.visual ?? null).toBeNull();
  });
});

describe("Vacancia / capacidad / cubículos · smoke 2026-07-07 (fuente = motor corporativo)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("'¿Qué porcentaje de vacancia tenemos en la actualidad?' → vacancy_overview con KPI, no vacío", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Qué porcentaje de vacancia tenemos en la actualidad?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].entityType).toBe("vacancy_metric");
    expect(res.sources[0].url).toBe("/comercial/dashboard-vacancia");
    expect(res.visual).toBeTruthy();
    expect(res.visual!.kpis!.some((k) => k.label.toLowerCase().includes("vacancia"))).toBe(true);
  });

  it("'¿Cuántos metros cuadrados tenemos disponibles para cargas generales?' → responde m² por categoría", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(
      baseReq("¿Cuántos metros cuadrados tenemos disponibles para cargas generales?")
    );
    expect(res.outcome).toBe("answered");
    expect(res.sources.some((s) => s.entityType === "vacancy_metric")).toBe(true);
    expect(res.answer.toLowerCase()).toContain("cargas generales");
  });

  it("'¿Cuántos cubículos de ANMAT están alquilados en la actualidad?' → responde con la métrica real", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(
      baseReq("¿Cuántos cubículos de ANMAT están alquilados en la actualidad?")
    );
    expect(res.outcome).toBe("answered");
    expect(res.sources.some((s) => s.entityType === "vacancy_metric")).toBe(true);
  });

  it("guard fix: 'plancheta de Habilitacion de Lujan 3159' → answered vía docs_browse (ya no degrada)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("plancheta de Habilitacion de Lujan 3159"));
    expect(res.outcome).toBe("answered");
    expect(res.sources[0].tool).toBe("docs_browse");
  });
});

describe("Contratos · intención SINGULAR + período honesto (smoke humano 2026-07-07)", () => {
  beforeEach(() => vi.stubEnv("AI_ENABLED", "1"));

  it("'Me podrías dar el último contrato firmado?' → UNA sola fuente + card única (no tabla de 30)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("Me podrías dar el último contrato firmado?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBe(1); // singular = UNA entidad principal
    expect(res.sources[0].tool).toBe("contracts_overview");
    expect(res.visual?.kind).toBe("document");
    // nunca el KPI de mes calendario cuando el usuario no acotó período
    const labels = (res.visual?.kpis ?? []).map((k) => k.label.toLowerCase()).join(" ");
    expect(labels).not.toContain("último mes");
  });

  it("'¿Cuál fue el último contrato ANMAT firmado?' → singular con filtro de tipo", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuál fue el último contrato ANMAT firmado?"));
    expect(res.outcome).toBe("answered");
    expect(res.sources.length).toBe(1);
    expect(res.visual?.kind).toBe("document");
  });

  it("'¿Cuántos contratos se firmaron el último mes?' → KPI de mes calendario (el período SÍ fue pedido)", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("¿Cuántos contratos se firmaron el último mes?"));
    expect(res.outcome).toBe("answered");
    expect(res.visual?.kpis?.[0]?.label.toLowerCase()).toContain("último mes");
  });

  it("'Mostrame los contratos vigentes' → dashboard: KPIs múltiples + donut + calidad documental", async () => {
    const { askCopilot } = await loadEngine();
    const res = await askCopilot(baseReq("Mostrame los contratos vigentes"));
    expect(res.outcome).toBe("answered");
    expect(res.visual?.kind).toBe("report");
    expect(res.visual?.kpis?.length).toBeGreaterThanOrEqual(4);
    expect(res.visual?.chart?.type).toBe("donut");
    // la brecha documental es visible: algún KPI habla de Drive/vínculo
    const labels = (res.visual?.kpis ?? []).map((k) => k.label.toLowerCase()).join(" ");
    expect(labels).toMatch(/drive|vínculo/);
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
