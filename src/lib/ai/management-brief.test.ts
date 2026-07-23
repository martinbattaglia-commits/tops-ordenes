// Copiloto de gestión (paradigma 2026-07-07) · Capa MANAGEMENT BRIEF.
// TDD RED: estos tests definen el contrato de la capa de inteligencia de
// gestión ANTES de implementarla. La capa NO inventa datos: compone filas
// determinísticas desde las tools existentes (demo mode = fixtures) y deriva
// riesgos/oportunidades/recomendaciones/brechas SOLO con evidencia.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

async function loadBrief() {
  const mod = await import("./management-brief");
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  // Demo mode real (patrón engine.test): sin Supabase env → fixtures, sin red.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("AI_PROVIDER", "mock");
  vi.stubEnv("AI_ENABLED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("detectManagementIntent — intención gerencial (Fase 4)", () => {
  const gerenciales: Array<[string, string]> = [
    [
      "Si mañana tengo una reunión de dirección, preparame el resumen ejecutivo de Nexus con KPIs, alertas, gráficos, riesgos, oportunidades y recomendaciones concretas basadas solo en datos de Nexus.",
      "resumen",
    ],
    [
      "Haceme un informe ejecutivo de situación de Nexus usando facturación, tesorería, contratos, compliance, vacancia y operación.",
      "resumen",
    ],
    [
      "Decime cuáles son los 10 riesgos más importantes que hoy aparecen en Nexus, ordenados por impacto y urgencia.",
      "riesgos",
    ],
    ["Qué debería mirar primero hoy?", "prioridades"],
    ["Preparame un tablero para reunión de dirección.", "resumen"],
    ["¿Cómo viene el negocio?", "resumen"],
    ["¿Qué oportunidades comerciales tenemos?", "oportunidades"],
    ["¿Dónde están los riesgos?", "riesgos"],
    ["¿Qué área está más comprometida?", "resumen"],
    // Slice A (manual de aceptación 2026-07-07): formulaciones gerenciales del
    // brief de Dirección que caían en search_knowledge.
    ["Haceme un tablero de salud de Nexus con indicadores por área.", "resumen"],
    ["Preparame una lectura de tesorería para dirección.", "resumen"],
    ["Haceme un reporte financiero ejecutivo con saldos bancarios, caja chica y alertas de liquidez.", "resumen"],
    ["Qué decisiones recomendarías tomar esta semana basadas solo en datos de Nexus.", "prioridades"],
    ["Preparame un tablero para comité: negocio, finanzas, riesgo, operación y próximos pasos.", "resumen"],
    ["Armame un reporte de gobernanza: fuentes incompletas, datos sin clasificar y documentos sin link real.", "resumen"],
    ["Detectá posibles tensiones financieras usando saldos, compras y facturación.", "riesgos"],
    ["Preparame un pipeline ejecutivo con próximos pasos comerciales.", "oportunidades"],
    // Slice B: lectura gerencial de 4 dimensiones y "qué mejoró/empeoró".
    ["Qué está sano, qué está en riesgo, qué está trabado y qué oportunidad comercial aparece.", "resumen"],
    ["Decime qué empeoró y qué mejoró en Nexus respecto al período anterior.", "resumen"],
  ];
  for (const [q, focus] of gerenciales) {
    it(`"${q.slice(0, 60)}…" → focus ${focus}`, async () => {
      const { detectManagementIntent } = await loadBrief();
      expect(detectManagementIntent(q)).toEqual({ focus });
    });
  }

  // Las preguntas de DOMINIO puntual siguen su ruteo actual (regresión):
  // el detector es conservador a propósito para no canibalizar tools específicas.
  const noGerenciales = [
    "¿Cuánta plata hay en Santander?",
    "¿Cuál fue el último contrato ANMAT firmado?",
    "¿Qué clientes están en riesgo?",
    "¿Qué documentos de compliance están pendientes?",
    "¿Qué porcentaje de vacancia tenemos?",
    "Resumime el estado del depósito",
    "Resumime el contrato de Distribuidora Ficticia",
    "¿Qué workflows están trabados?",
  ];
  for (const q of noGerenciales) {
    it(`"${q}" NO es intención gerencial`, async () => {
      const { detectManagementIntent } = await loadBrief();
      expect(detectManagementIntent(q)).toBeNull();
    });
  }
});

describe("composeManagementBriefRows — composición multi-dominio (demo mode)", () => {
  it("cubre los dominios del slice con filas de sección y estado semántico", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({});
    const secciones = rows
      .filter((r) => r.kind === "seccion")
      .map((r) => String(r.seccion));
    for (const s of [
      "facturacion",
      "tesoreria",
      "compras",
      "contratos",
      "compliance",
      "vacancia",
      "operacion",
    ]) {
      expect(secciones, `falta sección ${s}`).toContain(s);
    }
    for (const r of rows.filter((x) => x.kind === "seccion")) {
      expect(["ok", "atencion", "critico", "sin_datos"]).toContain(String(r.estado));
      expect(String(r.titulo)).toBeTruthy();
      expect(String(r.detalle)).toBeTruthy();
    }
  });

  it("deriva riesgos con impacto, urgencia, evidencia y acción (nunca sin evidencia)", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({});
    const riesgos = rows.filter((r) => r.kind === "riesgo");
    expect(riesgos.length).toBeGreaterThan(0);
    for (const r of riesgos) {
      expect(["alto", "medio", "bajo"]).toContain(String(r.impacto));
      expect(["alta", "media", "baja"]).toContain(String(r.urgencia));
      expect(String(r.evidencia)).toBeTruthy();
      expect(String(r.accion)).toBeTruthy();
      expect(String(r.detalle)).toBeTruthy();
    }
  });

  it("riesgos ordenados por impacto y urgencia (alto/alta primero)", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({});
    const riesgos = rows.filter((r) => r.kind === "riesgo");
    const rank = (r: Row) =>
      (r.impacto === "alto" ? 0 : r.impacto === "medio" ? 10 : 20) +
      (r.urgencia === "alta" ? 0 : r.urgencia === "media" ? 1 : 2);
    const ranks = riesgos.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("deriva oportunidades con evidencia (capacidad disponible)", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({});
    const oportunidades = rows.filter((r) => r.kind === "oportunidad");
    expect(oportunidades.length).toBeGreaterThan(0);
    // La capacidad disponible (fixture: 3700 m²) es la oportunidad testigo.
    expect(
      oportunidades.some((o) => String(o.detalle).includes("m²")),
      "esperaba oportunidad de m² disponibles"
    ).toBe(true);
    for (const o of oportunidades) {
      expect(String(o.evidencia)).toBeTruthy();
    }
  });

  it("declara brechas de cobertura (caja chica sin fuente conectada) — Fase 6", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({});
    const brechas = rows.filter((r) => r.kind === "brecha");
    expect(brechas.length).toBeGreaterThan(0);
    expect(
      brechas.some((b) => String(b.detalle).toLowerCase().includes("caja chica")),
      "la brecha de caja chica debe declararse, no esconderse"
    ).toBe(true);
  });

  it("no supera 20 filas (tope de chunks citables por tool)", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({});
    expect(rows.length).toBeLessThanOrEqual(20);
  });

  it("focus=riesgos ordena los riesgos ANTES que las secciones (citas priorizadas)", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({ focus: "riesgos" });
    const firstSeccion = rows.findIndex((r) => r.kind === "seccion");
    const firstRiesgo = rows.findIndex((r) => r.kind === "riesgo");
    expect(firstRiesgo).toBeGreaterThanOrEqual(0);
    expect(firstRiesgo).toBeLessThan(firstSeccion);
  });

  // ── Slice B: comparación m/m dentro del brief (fuente: billing ultimos_meses) ──
  it("la sección facturación trae la variación vs mes anterior (delta m/m)", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({});
    const fact = rows.find((r) => r.kind === "seccion" && r.seccion === "facturacion");
    expect(fact).toBeTruthy();
    // Fixtures demo: 2026-06 = 12.5M vs 2026-05 = 9.8M → +27.6%.
    expect(`${fact!.hint} ${fact!.detalle}`).toMatch(/mes anterior|vs 2026-05/);
    expect(String(fact!.detalle)).toContain("27.6");
  });

  // Review adversarial Slice B (hallazgo ALTO): el headline y el delta del brief
  // usan meses CERRADOS — el mes en curso parcial jamás fabrica una "caída".
  it("el headline del brief es el último mes CERRADO; el mes en curso parcial no dispara riesgo falso", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({});
    const fact = rows.find((r) => r.kind === "seccion" && r.seccion === "facturacion");
    // Con el fixture del mes en curso (parcial), el valor principal sigue siendo
    // el último mes CERRADO (2026-06 = 12.5M), no el parcial.
    expect(String(fact!.valor)).toContain("12,500,000.00");
    // Y el delta reportado es cerrado-vs-cerrado (+27.6%), nunca parcial-vs-cerrado.
    expect(String(fact!.detalle)).toContain("27.6");
    // Ningún riesgo de "caída de facturación" fabricado por el mes parcial.
    const riesgoFact = rows.find(
      (r) => r.kind === "riesgo" && /facturaci/i.test(String(r.area))
    );
    expect(riesgoFact).toBeUndefined();
  });

  it("declara la brecha de comparaciones multi-dominio (solo facturación compara)", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({});
    const brechas = rows.filter((r) => r.kind === "brecha");
    expect(
      brechas.some((b) => /comparaci/i.test(String(b.detalle))),
      "la limitación de comparación se declara, no se maquilla"
    ).toBe(true);
  });

  it("'Sin clasificar' se declara como brecha visible (nunca se reparte)", async () => {
    const { composeManagementBriefRows } = await loadBrief();
    const rows: Row[] = await composeManagementBriefRows({});
    const textos = rows.map((r) => String(r.detalle)).join(" ");
    expect(textos.toLowerCase()).toContain("sin clasificar");
  });
});
