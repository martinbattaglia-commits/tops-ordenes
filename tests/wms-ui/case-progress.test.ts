/**
 * §7 VISUAL · LAS TRES DERIVACIONES, Y LA GARANTÍA D-4.
 *
 * `case-progress.ts` es puro: se prueba entero sin DOM, sin red y sin base. Lo
 * que se mide acá es que la pantalla no invente secuencia ni acción, y —lo más
 * importante— que **ningún texto de cara al operario nombre el umbral**.
 */
import { describe, expect, it } from "vitest";
import {
  deriveCaseProgress,
  deriveDecisionChecklist,
  deriveNowAction,
  type ProgressInput,
} from "@/lib/custody/case-progress";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

function vista(over: Partial<CustodyCaseView> = {}): CustodyCaseView {
  return {
    caseId: "c1", state: "PENDING_EVIDENCE", stateLabel: "Pendiente de evidencia",
    tone: "pending", version: 1, scope: "physical_unit", entityId: "u1",
    identity: {
      clientLabel: "Laboratorio Fénix S.A.", clientFromReception: false,
      casePublicId: "CINT-2026-000451", unitPublicId: "CPU-2026-000123",
      sku: "MUEBLE-DEMO-01", quantity: 1, lotNumber: null,
      receptionId: null, receptionPublicId: null,
    },
    holdLabels: [],
    ai: ai(),
    release: { enabled: false, blockers: [] },
    quarantine: { enabled: false, blockers: [] },
    reevaluation: { enabled: false, required: false, analysis: "never", inFlight: false, blockers: [], reason: null },
    inspection: { enabled: false, blockers: [], eligible: 0 },
    capture: { enabled: true, blockers: [] },
    podBlocked: true, podBlockedReason: "Despacho y POD bloqueados", podPdfReady: false,
    decision: null, createdAt: "2026-08-16T05:40:00.000Z", updatedAt: "2026-08-16T05:40:00.000Z",
    ...over,
  } as CustodyCaseView;
}

const inp = (v: CustodyCaseView, ing: boolean, egr: boolean): ProgressInput => ({
  view: v, tieneIngreso: ing, tieneEgreso: egr,
});

/** Completa `AiPanelView` para no repetir sus campos obligatorios en cada caso. */
function ai(over: Partial<CustodyCaseView["ai"]> = {}): CustodyCaseView["ai"] {
  return {
    executed: false, verdictLabel: null, confidencePercent: null,
    informativeOnly: true, note: null, failureLabel: null,
    ...over,
  } as CustodyCaseView["ai"];
}

/** Concordancia BAJA, la que exige mirar el bien. */
const BAJA = {
  verdict: "BAJA", label: "CONCORDANCIA BAJA",
  requirement: "inspección física obligatoria antes de poder decidir", tone: "danger",
} as const;

describe("§7 · la barra dice DÓNDE está parado el operario", () => {
  it("sin foto de ingreso ⇒ paso 1 de 5", () => {
    const p = deriveCaseProgress(inp(vista(), false, false));
    expect(p.current).toBe(1);
    expect(p.caption).toContain("Paso 1 de 5");
    expect(p.steps).toHaveLength(5);
    expect(p.steps[0].state).toBe("current");
    expect(p.steps[4].state).toBe("pending");
  });

  it("con ingreso y sin egreso ⇒ paso 2", () => {
    expect(deriveCaseProgress(inp(vista(), true, false)).current).toBe(2);
  });

  it("con el par completo y sin análisis ⇒ paso 3", () => {
    expect(deriveCaseProgress(inp(vista(), true, true)).current).toBe(3);
  });

  it("con análisis ejecutado ⇒ paso 4, y el rótulo cambia si exige inspección", () => {
    const alta = vista({ ai: ai({ executed: true, confidencePercent: 95 }) });
    expect(deriveCaseProgress(inp(alta, true, true)).steps[3].label).toBe("Decisión del encargado");

    const baja = vista({
      state: "HOLD",
      ai: ai({ executed: true, confidencePercent: 71 }),
    });
    const p = deriveCaseProgress(inp(baja, true, true));
    expect(p.current).toBe(4);
    expect(p.steps[3].label).toBe("Inspección física y decisión");
  });

  it("liberado ⇒ paso 5 de 5 · entrega y POD", () => {
    const v = vista({
      state: "RELEASED", podBlocked: false,
      decision: { kind: "release", label: "Liberado", decidedAt: "x", actorRole: "admin", reason: "y" },
    });
    const p = deriveCaseProgress(inp(v, true, true));
    expect(p.current).toBe(5);
    expect(p.caption).toContain("Entrega y POD");
  });

  it("en cuarentena el paso 4 queda BLOQUEADO y el 5 no se alcanza", () => {
    const v = vista({
      state: "QUARANTINED",
      decision: { kind: "quarantine", label: "Cuarentena", decidedAt: "x", actorRole: "admin", reason: "y" },
    });
    const p = deriveCaseProgress(inp(v, true, true));
    expect(p.steps[3].state).toBe("blocked");
    expect(p.steps[4].state).toBe("pending");
  });
});

describe("§7 · el bloque ▸ AHORA ofrece UNA sola acción", () => {
  it("cada estado propone exactamente una cosa, y sabe si está viva", () => {
    expect(deriveNowAction(inp(vista(), false, false)).kind).toBe("foto_ingreso");
    expect(deriveNowAction(inp(vista(), true, false)).kind).toBe("foto_egreso");
    expect(deriveNowAction(inp(vista(), true, true)).kind).toBe("esperando_analisis");

    const liberado = vista({ state: "RELEASED", podBlocked: false });
    const pod = deriveNowAction(inp(liberado, true, true));
    expect(pod.kind).toBe("pod");
    expect(pod.actionable).toBe(true);

    const cuarentena = vista({ state: "QUARANTINED" });
    expect(deriveNowAction(inp(cuarentena, true, true)).actionable).toBe(false);
  });

  it("la acción muerta se declara como tal en vez de ofrecer un botón inútil", () => {
    const sinPermiso = vista({ capture: { enabled: false, blockers: ["No tenés permiso"] } });
    expect(deriveNowAction(inp(sinPermiso, false, false)).actionable).toBe(false);
  });
});

describe("§7 · el checklist «para poder decidir»", () => {
  it("marca lo hecho y nombra lo que falta con su instrucción", () => {
    const v = vista({
      state: "HOLD",
      ai: ai({ executed: true, confidencePercent: 71, concordance: BAJA }),
      reevaluation: { enabled: true, required: false, analysis: "current", inFlight: false, blockers: [], reason: null },
    });
    const items = deriveDecisionChecklist(inp(v, true, true));
    expect(items.slice(0, 4).every((i) => i.done)).toBe(true);
    const ultimo = items[items.length - 1];
    expect(ultimo.done).toBe(false);
    expect(ultimo.hint).toContain("Registrala");
  });

  it("sin exigencia de inspección el checklist tiene cuatro ítems", () => {
    const v = vista({ ai: ai({ executed: true, confidencePercent: 95 }) });
    expect(deriveDecisionChecklist(inp(v, true, true))).toHaveLength(4);
  });
});

describe("⚠ D-4 · EL UMBRAL NO SALE A PANTALLA, EN NINGÚN TEXTO", () => {
  /**
   * «El umbral de detección no viaja al cliente ni a la pantalla del operario:
   *  publicar el corte enseña a operar por debajo de él.»
   *
   * Se recorren TODAS las cadenas que este módulo puede producir, en todos los
   * estados, y se comprueba que ninguna nombra el umbral —ni con cifra, ni con
   * la palabra sola, ni como «sobre/bajo el umbral»—.
   */
  const ESTADOS: Array<[string, ProgressInput]> = [
    ["sin ingreso", inp(vista(), false, false)],
    ["sin egreso", inp(vista(), true, false)],
    ["esperando análisis", inp(vista(), true, true)],
    ["concordancia baja", inp(vista({
      state: "HOLD",
      ai: ai({ executed: true, confidencePercent: 71, concordance: BAJA }),
      inspection: { enabled: true, blockers: [], eligible: 0 },
    }), true, true)],
    ["concordancia alta", inp(vista({
      ai: ai({ executed: true, confidencePercent: 95 }),
      release: { enabled: true, blockers: [] },
    }), true, true)],
    ["liberado", inp(vista({ state: "RELEASED", podBlocked: false }), true, true)],
    ["cuarentena", inp(vista({ state: "QUARANTINED" }), true, true)],
  ];

  it("ninguna cadena nombra el umbral ni su porcentaje", () => {
    for (const [nombre, input] of ESTADOS) {
      const now = deriveNowAction(input);
      const prog = deriveCaseProgress(input);
      const check = deriveDecisionChecklist(input);
      const texto = [
        now.label, now.help, prog.caption,
        ...prog.steps.map((s) => s.label),
        ...check.map((c) => `${c.label} ${c.hint ?? ""}`),
      ].join(" ").toLowerCase();

      expect(texto, `${nombre}: no debe decir «umbral»`).not.toContain("umbral");
      expect(texto, `${nombre}: no debe decir «90%»`).not.toContain("90%");
      expect(texto, `${nombre}: no debe decir «por encima»`).not.toContain("por encima");
      expect(texto, `${nombre}: no debe decir «por debajo»`).not.toContain("por debajo");
    }
  });

  /**
   * Y el reemplazo aprobado SÍ está: el fundamento se expresa como estándar,
   * que es lo que D-4 manda decir en lugar del corte.
   */
  it("el fundamento se expresa como ESTÁNDAR, no como corte", () => {
    const baja = inp(vista({
      state: "HOLD",
      ai: ai({ executed: true, confidencePercent: 71, concordance: BAJA }),
      inspection: { enabled: true, blockers: [], eligible: 0 },
    }), true, true);
    expect(deriveNowAction(baja).help).toContain("estándares internacionales de medición");
  });
});
