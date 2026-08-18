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

const inp = (
  v: CustodyCaseView,
  ing: boolean,
  egr: boolean,
  insp = false,
): ProgressInput => ({
  view: v, tieneIngreso: ing, tieneEgreso: egr, tieneInspeccion: insp,
});

/** Completa `AiPanelView` para no repetir sus campos obligatorios en cada caso. */
function ai(over: Partial<CustodyCaseView["ai"]> = {}): CustodyCaseView["ai"] {
  return {
    executed: false, verdictLabel: null, confidencePercent: null,
    informativeOnly: true, note: null, failureLabel: null,
    ...over,
  } as CustodyCaseView["ai"];
}

/** Concordancia ALTA, la que no exige inspección adicional. */
const ALTA = {
  verdict: "ALTA", label: "CONCORDANCIA ALTA",
  requirement: "no requiere inspección adicional · la decisión sigue siendo tuya", tone: "ok",
} as const;

/** Un análisis que corrió y FALLÓ: `executed` false CON `failureLabel`. */
const FALLIDO = { executed: false, failureLabel: "El proveedor no respondió a tiempo" };

/** Las fotos no son comparables. */
const NO_CONCLUYENTE = {
  verdict: "NO_CONCLUYENTE", label: "NO CONCLUYENTE",
  requirement: "las fotos no son comparables: repetí la de egreso", tone: "warn",
} as const;

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
   *
   * ─── REMEDIACIÓN C4 · M-5 · EL GUARD SE EVADÍA CON UN ESPACIO ────────────
   *
   * La versión anterior comparaba con `toContain("90%")`. «90 %» —con el
   * espacio fino que usa la tipografía castellana, que es como lo escribiría
   * cualquiera— pasaba limpio. Ahora el texto se NORMALIZA antes de mirarlo y
   * los patrones son expresiones regulares que toleran el espacio; se agregan
   * además el nombre del campo y el score crudo, que son las otras dos formas
   * en que el corte podría filtrarse.
   */
  const PROHIBIDO: Array<[string, RegExp]> = [
    ["la palabra «umbral»", /umbral/i],
    ["el número del corte, con o sin espacio", /\b90\s*%/],
    ["«por encima»", /por encima/i],
    ["«por debajo»", /por debajo/i],
    ["«sobre/bajo el …»", /\b(sobre|bajo)\s+(el|la)\s+(umbral|corte|l[íi]mite)/i],
    ["el nombre del campo", /threshold/i],
    ["«corte» como sustantivo de política", /\bcorte\s+de\s+(detecci[óo]n|similitud)/i],
  ];

  const ESTADOS: Array<[string, ProgressInput]> = [
    ["sin ingreso", inp(vista(), false, false)],
    ["sin egreso", inp(vista(), true, false)],
    ["esperando análisis", inp(vista(), true, true)],
    ["análisis fallido", inp(vista({
      ai: ai({ executed: false, failureLabel: "El proveedor no respondió a tiempo" }),
      reevaluation: { enabled: true, required: false, analysis: "current", inFlight: false, blockers: [], reason: null },
    }), true, true)],
    ["no concluyente", inp(vista({
      state: "REVIEW_REQUIRED",
      ai: ai({ executed: true, confidencePercent: 40, concordance: NO_CONCLUYENTE }),
    }), true, true)],
    ["concordancia baja", inp(vista({
      state: "HOLD",
      ai: ai({ executed: true, confidencePercent: 71, concordance: BAJA }),
      inspection: { enabled: true, blockers: [], eligible: 0 },
    }), true, true)],
    ["concordancia baja · inspección YA registrada", inp(vista({
      state: "HOLD",
      ai: ai({ executed: true, confidencePercent: 71, concordance: BAJA }),
      inspection: { enabled: true, blockers: [], eligible: 0 },
    }), true, true, true)],
    ["cadena desactualizada", inp(vista({
      ai: ai({ executed: true, confidencePercent: 95 }),
      reevaluation: { enabled: true, required: true, analysis: "stale", inFlight: false, blockers: [], reason: null },
    }), true, true)],
    ["sin análisis nunca", inp(vista({
      reevaluation: { enabled: false, required: false, analysis: "never", inFlight: false, blockers: [], reason: null },
    }), true, true)],
    ["concordancia alta", inp(vista({
      ai: ai({ executed: true, confidencePercent: 95, concordance: ALTA }),
      release: { enabled: true, blockers: [] },
    }), true, true)],
    ["liberado", inp(vista({ state: "RELEASED", podBlocked: false }), true, true)],
    ["cuarentena", inp(vista({ state: "QUARANTINED" }), true, true)],
  ];

  /** Todo el texto de cara al operario de un estado, normalizado. */
  function textoDe(input: ProgressInput): string {
    const now = deriveNowAction(input);
    const prog = deriveCaseProgress(input);
    const check = deriveDecisionChecklist(input);
    return [
      now.label, now.help, prog.caption,
      ...prog.steps.map((s) => s.label),
      ...check.map((c) => `${c.label} ${c.hint ?? ""}`),
    ]
      .join(" ")
      // El espacio fino, el duro y el normal se colapsan: «90 %» y «90 %» y
      // «90%» tienen que medirse todos como lo mismo.
      .replace(/[\s\u00a0\u202f\u2009]+/g, " ");
  }

  it("ninguna cadena nombra el umbral, en ninguna de sus formas", () => {
    for (const [nombre, input] of ESTADOS) {
      const texto = textoDe(input);
      for (const [queEs, patron] of PROHIBIDO) {
        expect(patron.test(texto), `${nombre}: no debe decir ${queEs} — «${texto}»`).toBe(false);
      }
    }
  });

  it("y el guard SÍ detecta la evasión con espacio que antes lo atravesaba", () => {
    // Control del propio guard: si esto pasara en verde, el test de arriba no
    // estaría midiendo nada. `toContain("90%")` —lo que había— da false acá.
    const evasion = "quedó 90 % sobre el umbral".replace(/[\s\u00a0\u202f\u2009]+/g, " ");
    expect(evasion.includes("90%")).toBe(false);
    expect(PROHIBIDO.some(([, p]) => p.test(evasion))).toBe(true);
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

// ═══════════════════════════════════════════════════════════════════════════
// REMEDIACIÓN C4 · GRUPO A · CADA CAMPO SIGNIFICA LO QUE DICE
// ═══════════════════════════════════════════════════════════════════════════
//
// Seis instancias de la misma causa raíz: el módulo leía campos del view-model
// asumiendo un significado que esos campos no tienen. Dos de ellas producían
// un bucle del que el operario no podía salir. Cada test de acá abajo cae en
// rojo con el código anterior.

describe("A-1 · «nunca se ejecutó» NO es «cadena verificada»", () => {
  it("sin ningún análisis, el ítem de cadena queda ABIERTO", () => {
    // `analysis: "never"` tampoco es `"stale"`; la versión anterior leía
    // `!== "stale"` y ponía la tilde de verificado sobre un caso sin análisis.
    const v = vista({
      reevaluation: { enabled: false, required: false, analysis: "never", inFlight: false, blockers: [], reason: null },
    });
    const cadena = deriveDecisionChecklist(inp(v, true, true)).find(
      (i) => i.label === "Cadena de custodia verificada",
    );
    expect(cadena?.done).toBe(false);
    expect(cadena?.hint).toContain("Todavía no hay un análisis utilizable");
  });

  it("con el análisis desactualizado dice que hay que volver a pedirlo", () => {
    const v = vista({
      ai: ai({ executed: true, confidencePercent: 95 }),
      reevaluation: { enabled: true, required: true, analysis: "stale", inFlight: false, blockers: [], reason: null },
    });
    const cadena = deriveDecisionChecklist(inp(v, true, true)).find(
      (i) => i.label === "Cadena de custodia verificada",
    );
    expect(cadena?.done).toBe(false);
    expect(cadena?.hint).toContain("desactualizado");
  });

  it("con análisis utilizable y vigente, la tilde SÍ está", () => {
    const v = vista({
      ai: ai({ executed: true, confidencePercent: 95 }),
      reevaluation: { enabled: true, required: false, analysis: "current", inFlight: false, blockers: [], reason: null },
    });
    const cadena = deriveDecisionChecklist(inp(v, true, true)).find(
      (i) => i.label === "Cadena de custodia verificada",
    );
    expect(cadena?.done).toBe(true);
  });
});

describe("A-2 · EL BUCLE DEL OPERARIO · la inspección se lee del TIMELINE", () => {
  /**
   * `inspection.eligible` se calcula detrás de un guard de
   * `wms.custody.decide`. El operario de depósito captura con `wms.edit` y NO
   * tiene ese permiso, así que para él vale 0 siempre. Leerlo como «hay foto»
   * le pedía registrar una inspección ya registrada, para siempre.
   *
   * Las dos fixtures de abajo son EXACTAMENTE ese caso: `eligible: 0` —lo que
   * ve el operario sin permiso de decisión— con la foto YA registrada.
   */
  const conBaja = () =>
    vista({
      state: "HOLD",
      ai: ai({ executed: true, confidencePercent: 71, concordance: BAJA }),
      inspection: { enabled: true, blockers: [], eligible: 0 },
    });

  it("con la foto registrada, ▸AHORA deja de pedirla aunque `eligible` sea 0", () => {
    const now = deriveNowAction(inp(conBaja(), true, true, true));
    expect(now.kind).not.toBe("inspeccion");
    expect(now.kind).toBe("decidir");
    expect(now.help).toContain("La inspección física ya está registrada");
  });

  it("con la foto registrada, el checklist la marca hecha aunque `eligible` sea 0", () => {
    const items = deriveDecisionChecklist(inp(conBaja(), true, true, true));
    const ultimo = items[items.length - 1];
    expect(ultimo.label).toBe("Inspección física registrada");
    expect(ultimo.done).toBe(true);
  });

  it("sin la foto, la sigue pidiendo: la exigencia no se perdió", () => {
    const now = deriveNowAction(inp(conBaja(), true, true, false));
    expect(now.kind).toBe("inspeccion");
    const items = deriveDecisionChecklist(inp(conBaja(), true, true, false));
    expect(items[items.length - 1].done).toBe(false);
  });
});

describe("A-3 · UNA sola definición de «exige inspección» para las tres", () => {
  it("las tres derivaciones coinciden en todos los casos de exigencia", () => {
    const casos: Array<[string, CustodyCaseView]> = [
      ["HOLD sin veredicto", vista({ state: "HOLD", ai: ai({ executed: true }) })],
      ["veredicto BAJA sin HOLD", vista({
        state: "REVIEW_REQUIRED",
        ai: ai({ executed: true, concordance: BAJA }),
        inspection: { enabled: true, blockers: [], eligible: 0 },
      })],
    ];
    for (const [nombre, v] of casos) {
      const i = inp(v, true, true, false);
      // la barra rotula el paso 4 como inspección…
      expect(deriveCaseProgress(i).steps[3].label, nombre).toBe("Inspección física y decisión");
      // …el checklist agrega su quinto ítem…
      expect(deriveDecisionChecklist(i), nombre).toHaveLength(5);
      // …y ▸AHORA pide la inspección. Las tres, o ninguna.
      expect(deriveNowAction(i).kind, nombre).toBe("inspeccion");
    }
  });

  it("y coinciden también cuando NO hay exigencia", () => {
    const v = vista({ ai: ai({ executed: true, concordance: ALTA }), release: { enabled: true, blockers: [] } });
    const i = inp(v, true, true, false);
    expect(deriveCaseProgress(i).steps[3].label).toBe("Decisión del encargado");
    expect(deriveDecisionChecklist(i)).toHaveLength(4);
    expect(deriveNowAction(i).kind).toBe("decidir");
  });
});

describe("A-4 · un análisis CAÍDO no está «corriendo»", () => {
  it("▸AHORA ofrece volver a pedirlo, y nombra el fallo", () => {
    const v = vista({
      ai: ai({ ...FALLIDO }),
      reevaluation: { enabled: true, required: false, analysis: "current", inFlight: false, blockers: [], reason: null },
    });
    const now = deriveNowAction(inp(v, true, true));
    expect(now.kind).toBe("analisis_fallido");
    expect(now.help).toContain("no pudo completarse");
    expect(now.actionable).toBe(true);
  });

  it("si no se puede re-pedir, se informa y NO se ofrece un botón muerto", () => {
    const v = vista({
      ai: ai({ ...FALLIDO }),
      reevaluation: { enabled: false, required: false, analysis: "current", inFlight: true, blockers: ["Ya hay una evaluación en curso"], reason: null },
    });
    expect(deriveNowAction(inp(v, true, true)).actionable).toBe(false);
  });

  it("la barra marca el paso 3 BLOQUEADO, no «en curso»", () => {
    const v = vista({ ai: ai({ ...FALLIDO }) });
    expect(deriveCaseProgress(inp(v, true, true)).steps[2].state).toBe("blocked");
  });

  it("sin `failureLabel` sigue siendo «está corriendo»: no se confunden", () => {
    const now = deriveNowAction(inp(vista(), true, true));
    expect(now.kind).toBe("esperando_analisis");
    expect(deriveCaseProgress(inp(vista(), true, true)).steps[2].state).toBe("current");
  });
});

describe("A-5 · NO CONCLUYENTE tiene su propia salida", () => {
  it("pide repetir el egreso en vez de afirmar que no hubo diferencias", () => {
    const v = vista({
      state: "REVIEW_REQUIRED",
      ai: ai({ executed: true, confidencePercent: 40, concordance: NO_CONCLUYENTE }),
    });
    const now = deriveNowAction(inp(v, true, true));
    expect(now.kind).toBe("repetir_egreso");
    // La afirmación falsa de la versión anterior, explícitamente ausente.
    expect(now.help).not.toContain("no encontró diferencias");
    expect(now.help).toContain("no resultaron comparables");
  });
});

describe("A-6 · el botón de inspección se ofrece vivo sólo si se puede usar", () => {
  it("sin permiso de captura de inspección, la acción NO es accionable", () => {
    const v = vista({
      state: "HOLD",
      ai: ai({ executed: true, concordance: BAJA }),
      inspection: { enabled: false, blockers: ["No tenés permiso para registrar evidencia"], eligible: 0 },
    });
    const now = deriveNowAction(inp(v, true, true, false));
    // Discriminante: la exigencia SIGUE siendo la de inspección —el caso no se
    // degrada a «decidí»— y lo que cambia es que el botón no se ofrece vivo.
    expect(now.kind).toBe("inspeccion");
    expect(now.actionable).toBe(false);
  });
});
