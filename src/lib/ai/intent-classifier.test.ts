// Pirámide de conocimiento (2026-07-07) · CLASIFICADOR DE INTENCIÓN.
// TDD RED: define el contrato ANTES de implementar. Principio: el Copilot no
// puede ser un sabio adentro de Nexus y un amnésico afuera — pero el DEFAULT
// es nexus_internal (fail-safe: ante la duda, el comportamiento actual).

import { describe, expect, it } from "vitest";
import { classifyCopilotIntent } from "./intent-classifier";

describe("classifyCopilotIntent · capas de la pirámide", () => {
  it("general_current: fecha/hora del servidor (triviales, sin API externa)", () => {
    expect(classifyCopilotIntent("¿Qué día es hoy?")).toEqual({ tipo: "general_current", tema: "fecha" });
    expect(classifyCopilotIntent("¿Qué hora es?")).toEqual({ tipo: "general_current", tema: "hora" });
    expect(classifyCopilotIntent("¿Qué fecha es hoy?")).toEqual({ tipo: "general_current", tema: "fecha" });
  });

  it("general_current: dólar/noticias/clima/inflación (requieren fuente externa)", () => {
    expect(classifyCopilotIntent("¿Cuánto cotiza el dólar?")).toEqual({ tipo: "general_current", tema: "dolar" });
    expect(classifyCopilotIntent("¿Cuáles son las noticias más importantes del día?")).toEqual({ tipo: "general_current", tema: "noticias" });
    expect(classifyCopilotIntent("¿Qué pasó hoy en Argentina?")).toEqual({ tipo: "general_current", tema: "noticias" });
    expect(classifyCopilotIntent("¿Cómo está el clima?")).toEqual({ tipo: "general_current", tema: "clima" });
    expect(classifyCopilotIntent("¿Cuál es la inflación actual?")).toEqual({ tipo: "general_current", tema: "inflacion" });
  });

  it("general_static: conceptos sin actualidad (los responde el proveedor de IA)", () => {
    for (const q of [
      "¿Qué es ANMAT?",
      "¿Qué es un operador logístico 3PL?",
      "¿Qué significa RNE?",
      "¿Cómo se calcula la vacancia?",
      "¿Cuál es la diferencia entre gasto y presupuesto?",
    ]) {
      expect(classifyCopilotIntent(q), q).toEqual({ tipo: "general_static" });
    }
  });

  it("company_institutional: servicios/propuesta/web de Logística TOPS → brecha institucional", () => {
    for (const q of [
      "¿Qué servicios ofrece Logística TOPS?",
      "¿Cómo trabaja Logística TOPS con productos regulados?",
      "¿Qué dice nuestra web sobre cargas generales?",
      "¿Cómo presentar la propuesta comercial de depósitos regulados?",
    ]) {
      expect(classifyCopilotIntent(q).tipo, q).toBe("company_institutional");
    }
  });

  it("internal_research: capacitaciones/investigaciones → capa NotebookLM", () => {
    for (const q of [
      "Armame una capacitación sobre almacenamiento regulado ANMAT",
      "¿Qué aprendimos de la investigación sobre FDA?",
      "Compará nuestra operación con mejores prácticas 3PL",
    ]) {
      expect(classifyCopilotIntent(q).tipo, q).toBe("internal_research");
    }
  });

  it("mixed_nexus_external: dato Nexus + dato externo (dólar)", () => {
    for (const q of [
      "Con el dólar actual, ¿cuánto representa la facturación del último mes en USD?",
      "Convertime la facturación del último mes a dólares al tipo de cambio actual",
      "Con el dólar de hoy, ¿cuánto valen nuestros ingresos ANMAT en USD?",
    ]) {
      expect(classifyCopilotIntent(q).tipo, q).toBe("mixed_nexus_external");
    }
  });

  // ── Review adversarial pirámide (2026-07-07): 6 hallazgos confirmados ──────
  it("REVIEW A: comparaciones de datos internos con 'diferencia entre' NO son general_static", () => {
    // Reformulaciones de las preguntas de aceptación 5-7 y 6-4: con 'comparame'
    // van a Nexus; con 'diferencia entre' NO pueden desviarse a conocimiento
    // general (era la violación máxima del contrato).
    for (const q of [
      "¿Cuál es la diferencia entre Magaldi y Luján en compliance?",
      "¿Cuál es la diferencia entre los contratos ANMAT y Cargas Generales?",
      "¿Cuál es la diferencia entre el saldo del Galicia y el del Santander?",
      "¿Cuál es la diferencia entre lo facturado en junio y en mayo?",
    ]) {
      expect(classifyCopilotIntent(q).tipo, q).toBe("nexus_internal");
    }
  });

  it("REVIEW B: verbos plurales/impersonales de dato interno vetan general_static", () => {
    for (const q of [
      "¿Qué es lo que más gastamos?",
      "¿Qué es lo que más se factura?",
      "¿Qué es lo que más vendemos?",
      "¿Qué es lo que más pagamos a proveedores?",
      "¿Qué es lo que más cobramos este trimestre?",
    ]) {
      expect(classifyCopilotIntent(q).tipo, q).toBe("nexus_internal");
    }
  });

  it("REVIEW C: fecha/hora/clima no secuestran preguntas internas (substring anclado + veto)", () => {
    for (const q of [
      "¿A qué hora es la reunión de dirección?",
      "¿Qué día de la semana facturamos más?",
      "¿Cómo está el clima laboral en la operación?",
      "¿A qué hora abrió el depósito hoy?",
    ]) {
      expect(classifyCopilotIntent(q).tipo, q).toBe("nexus_internal");
    }
    // Las triviales puras siguen siendo general_current.
    expect(classifyCopilotIntent("¿Qué hora es?").tipo).toBe("general_current");
    expect(classifyCopilotIntent("¿Qué día es hoy?").tipo).toBe("general_current");
  });

  it("REVIEW D: normativa específica con vigencia → general_current (requiere fuente oficial), no static inventable", () => {
    for (const q of [
      "¿Qué es la disposición 3827/2018 de ANMAT y sigue vigente?",
      "¿Sigue vigente la resolución general 5616 de ARCA?",
      "¿Qué dice la ley 27.442 actualmente?",
    ]) {
      const r = classifyCopilotIntent(q);
      expect(r.tipo, q).toBe("general_current");
      if (r.tipo === "general_current") expect(r.tema).toBe("normativa");
    }
    // Un concepto sin número ni vigencia sigue siendo static.
    expect(classifyCopilotIntent("¿Qué es una disposición de ANMAT?").tipo).toBe("general_static");
  });

  it("nexus_internal es el DEFAULT y las preguntas de datos internos NUNCA se desvían", () => {
    for (const q of [
      "¿Cuánto facturamos el último mes?",
      "¿Qué contratos están por vencer?",
      "¿Quién es el presidente de Logística TOPS?",
      "¿Qué porcentaje de vacancia tenemos?",
      "¿Qué pasó hoy en operaciones?",
      "¿Qué documentos de compliance están pendientes?",
      "Preparame el resumen ejecutivo de Nexus para la reunión de dirección",
      "¿Qué temperatura tiene la cámara 3?",
      "¿Qué es lo que más facturamos?",
      "¿Qué secciones tiene Nexus?",
      "cualquier otra cosa rara",
      // Regresión batería v7: "qué es" sin boundary matcheaba "qué ESpacios" y
      // "qué EStá sano" → caían en general_static.
      "Qué espacios disponibles pueden transformarse en oportunidad de venta.",
      "Qué está sano, qué está en riesgo, qué está trabado y qué oportunidad comercial aparece.",
    ]) {
      expect(classifyCopilotIntent(q).tipo, q).toBe("nexus_internal");
    }
  });
});

// ── Ampliación general estático/actualidad (2026-07-08) ─────────────────────
// El Copilot estaba demasiado restringido: conceptos generales con formas más
// allá de "qué es" caían en el DEFAULT nexus_internal → "no encontré". Se amplía
// general_static (con guarda de posesivos) y general_current (dólar BNA, deportes,
// política/economía). Sin romper el veto de datos internos.
describe("classifyCopilotIntent · general ampliado (2026-07-08)", () => {
  it("general_static: conceptos con formas más allá de 'qué es'", () => {
    for (const q of [
      "¿Qué riesgos tiene una operación logística?",
      "¿Qué métricas mira un gerente de depósito?",
      "¿Cómo funciona el cross docking?",
      "¿Para qué sirve un WMS?",
      "¿Cuáles son las ventajas de un operador 3PL?",
      "¿Qué tipos de almacenamiento existen?",
    ]) {
      expect(classifyCopilotIntent(q).tipo, q).toBe("general_static");
    }
  });

  it("general_static NO hijackea datos internos con posesivos/1ª persona", () => {
    for (const q of [
      "¿Qué riesgos tiene nuestra operación?",
      "¿Qué métricas tenemos en el depósito?",
      "¿Qué riesgos tiene nuestro depósito de Magaldi?",
    ]) {
      expect(classifyCopilotIntent(q).tipo, q).toBe("nexus_internal");
    }
  });

  it("general_current dólar: variantes Banco Nación / BNA / oficial venta", () => {
    for (const q of [
      "¿Cuánto está el dólar hoy?",
      "Dólar Banco Nación venta",
      "Cotización dólar BNA",
      "USD/ARS Banco Nación",
      "Dólar oficial venta",
    ]) {
      const r = classifyCopilotIntent(q);
      expect(r.tipo, q).toBe("general_current");
      if (r.tipo === "general_current") expect(r.tema, q).toBe("dolar");
    }
  });

  it("general_current deportes: resultados en tiempo real", () => {
    for (const q of ["¿Cómo salió Argentina vs Egipto?", "¿Cómo salió la selección?", "¿Quién ganó el partido?"]) {
      const r = classifyCopilotIntent(q);
      expect(r.tipo, q).toBe("general_current");
      if (r.tipo === "general_current") expect(r.tema, q).toBe("deportes");
    }
  });

  it("general_current noticias/política/economía: variantes ampliadas", () => {
    for (const q of [
      "¿Qué pasó hoy en política argentina?",
      "¿Qué noticias económicas importantes hay esta semana?",
      "¿Hay novedades recientes de ANMAT?",
    ]) {
      expect(classifyCopilotIntent(q).tipo, q).toBe("general_current");
    }
  });
});
