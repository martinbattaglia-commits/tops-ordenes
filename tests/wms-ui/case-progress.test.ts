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

/** Concordancia ALTA. No exime de la inspección: la exigencia es incondicional (R-1). */
const ALTA = {
  verdict: "ALTA", label: "CONCORDANCIA ALTA",
  requirement: "conforme · la inspección física y la decisión siguen siendo tuyas", tone: "ok",
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

  it("con análisis ejecutado ⇒ paso 4 · «Inspección física y decisión» SIEMPRE (R-1)", () => {
    // La versión anterior de este test fijaba «Decisión del encargado» para
    // concordancia alta: era un candado sobre el defecto. La autoridad exige
    // inspección en TODA liberación, así que el rótulo no varía por veredicto.
    const alta = vista({ ai: ai({ executed: true, confidencePercent: 95 }) });
    expect(deriveCaseProgress(inp(alta, true, true)).steps[3].label).toBe("Inspección física y decisión");

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

  it("el checklist SIEMPRE tiene cinco ítems: la inspección no es opcional (R-1)", () => {
    // El test anterior fijaba cuatro ítems para concordancia alta — 4/4
    // «Hecho» sobre un caso que el servidor rechaza por falta de inspección.
    const v = vista({ ai: ai({ executed: true, confidencePercent: 95 }) });
    const items = deriveDecisionChecklist(inp(v, true, true));
    expect(items).toHaveLength(5);
    expect(items[4].label).toBe("Falta la foto de inspección física");
    expect(items[4].done).toBe(false);
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
   * ─── REMEDIACIÓN C4 · M-5 y R-4 · EL GUARD SE EVADÍA, DOS VECES ──────────
   *
   * M-5: la versión anterior comparaba con `toContain("90%")` y «90 %» —con
   * espacio— pasaba limpio. R-4 (C4 1/2): la siguiente versión DECÍA cubrir el
   * valor crudo del corte y no lo cubría — «el mínimo exigido es 90», «noventa
   * por ciento», «similitud requerida: 0,9» y «debajo del mínimo de detección»
   * atravesaban el guard mientras su docblock afirmaba lo contrario.
   *
   * Ahora el texto se NORMALIZA y los patrones cubren: la palabra, el número
   * con y sin «%», la grafía en letras, la fracción cruda, y las perífrasis de
   * piso/mínimo. En las cadenas de ESTE módulo el «90» a secas es seguro de
   * prohibir: ningún texto legítimo de derivación transporta números de score
   * (los porcentajes reales viven en `CaseAiPanel`, con su propio barrido).
   */
  const PROHIBIDO: Array<[string, RegExp]> = [
    ["la palabra «umbral»", /umbral/i],
    ["el número del corte, con o sin «%»", /\b90\b/],
    ["el número del corte en letras", /\bnoventa\b/i],
    ["la fracción cruda del corte", /\b0[.,]9\b(?!\d)/],
    ["«por encima»", /por encima/i],
    ["«por debajo»", /por debajo/i],
    ["«sobre/bajo el …»", /\b(sobre|bajo)\s+(el|la)\s+(umbral|corte|l[íi]mite|m[íi]nimo|piso)/i],
    ["el nombre del campo", /threshold/i],
    ["«corte/mínimo/piso» como sustantivo de política", /\b(corte|m[íi]nimo|piso)\s+de\s+(detecci[óo]n|similitud)/i],
    ["«mínimo/piso exigido o requerido»", /\b(m[íi]nimo|piso)\s+(exigido|requerido)/i],
    ["«similitud requerida/exigida/mínima»", /\bsimilitud\s+(requerida|exigida|m[íi]nima)/i],
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

  it("y el guard SÍ caza las evasiones demostradas — el espacio y el valor crudo", () => {
    // Control del propio guard: si esto pasara en verde, el test de arriba no
    // estaría midiendo nada. Las seis frases de abajo son las que la C4 1/2
    // demostró que ATRAVESABAN la versión anterior (R-4), más la del espacio
    // (M-5). `toContain("90%")` —lo que había al principio— da false en todas.
    const evasiones = [
      "quedó 90 % sobre el umbral",
      "el mínimo exigido es 90",
      "quedó al 90 por ciento",
      "noventa por ciento",
      "similitud requerida: 0,9",
      "no llegó al piso de 90 puntos",
      "debajo del mínimo de detección",
    ];
    for (const cruda of evasiones) {
      const evasion = cruda.replace(/[\s\u00a0\u202f\u2009]+/g, " ");
      expect(
        PROHIBIDO.some(([, p]) => p.test(evasion)),
        `el guard debe cazar: «${cruda}»`,
      ).toBe(true);
    }
    // Y un texto legítimo del módulo NO dispara nada: guard sin falsos positivos.
    const legitimo = "Paso 4 de 5 · Inspección física y decisión";
    expect(PROHIBIDO.some(([, p]) => p.test(legitimo))).toBe(false);
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

  it("y coinciden también con concordancia ALTA: la exigencia no distingue veredicto (R-1)", () => {
    const v = vista({
      ai: ai({ executed: true, concordance: ALTA }),
      inspection: { enabled: true, blockers: [], eligible: 0 },
    });
    const i = inp(v, true, true, false);
    expect(deriveCaseProgress(i).steps[3].label).toBe("Inspección física y decisión");
    expect(deriveDecisionChecklist(i)).toHaveLength(5);
    expect(deriveNowAction(i).kind).toBe("inspeccion");
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

// ═══════════════════════════════════════════════════════════════════════════
// R-1 · LA EXIGENCIA DE INSPECCIÓN ES LA DE LA AUTORIDAD, NO LA DEL VEREDICTO
// ═══════════════════════════════════════════════════════════════════════════
//
// C4 1/2 FAIL: la definición unificada «HOLD ‖ BAJA» contradecía la autoridad.
// `release-policy.ts` agrega `NO_HUMAN_INSPECTION_EVIDENCE` de forma
// INCONDICIONAL, y la RPC viva (`0251:214-215`) levanta «inspección humana
// obligatoria» después del if/else de basis: alcanza a las DOS ramas. En el
// camino más común —ALTA sin foto— la pantalla decía 4/4 «Hecho» y «decidí», y
// el servidor rechazaba. Estos tests fijan la autoridad; el mutante de R-26
// (revertir a `HOLD ‖ BAJA`) los pone en rojo.

describe("R-1 · el camino feliz ya no miente: ALTA sin foto exige inspección", () => {
  const altaSinFoto = () =>
    vista({
      state: "REVIEW_REQUIRED",
      ai: ai({ executed: true, confidencePercent: 95, concordance: ALTA }),
      inspection: { enabled: true, blockers: [], eligible: 0 },
      release: { enabled: false, blockers: ["Falta la foto de inspección humana"] },
      reevaluation: { enabled: true, required: false, analysis: "current", inFlight: false, blockers: [], reason: null },
    });

  it("el checklist NO dice 4/4: el quinto ítem queda pendiente y es el único", () => {
    const items = deriveDecisionChecklist(inp(altaSinFoto(), true, true, false));
    expect(items).toHaveLength(5);
    expect(items.slice(0, 4).every((i) => i.done)).toBe(true);
    expect(items[4].done).toBe(false);
    expect(items[4].label).toBe("Falta la foto de inspección física");
    expect(items[4].hint).toContain("Es el único paso que queda");
  });

  it("▸AHORA pide la inspección, con el lenguaje de conformidad — no el de BAJA", () => {
    const now = deriveNowAction(inp(altaSinFoto(), true, true, false));
    expect(now.kind).toBe("inspeccion");
    expect(now.help).toContain("resultó conforme");
    expect(now.help).toContain("la IA alerta, no decide");
    // La frase de disconformidad NO corresponde acá: la comparación fue conforme.
    expect(now.help).not.toContain("no fue conforme");
    expect(now.actionable).toBe(true);
  });

  it("con la foto registrada, ALTA pasa a «decidí» y el checklist cierra 5/5", () => {
    const i = inp(altaSinFoto(), true, true, true);
    expect(deriveNowAction(i).kind).toBe("decidir");
    const items = deriveDecisionChecklist(i);
    expect(items).toHaveLength(5);
    expect(items.every((it) => it.done)).toBe(true);
  });

  it("BAJA conserva la redacción aprobada por Dirección", () => {
    const v = vista({
      state: "HOLD",
      ai: ai({ executed: true, confidencePercent: 71, concordance: BAJA }),
      inspection: { enabled: true, blockers: [], eligible: 0 },
    });
    const now = deriveNowAction(inp(v, true, true, false));
    expect(now.kind).toBe("inspeccion");
    expect(now.help).toContain("no fue conforme según los estándares internacionales de medición");
  });

  it("el hint de «único paso» no aparece si hay otras condiciones pendientes", () => {
    // Sin análisis todavía: la inspección no es «lo único que queda».
    const items = deriveDecisionChecklist(inp(vista(), true, true, false));
    const ultimo = items[items.length - 1];
    expect(ultimo.done).toBe(false);
    expect(ultimo.hint).toBeUndefined();
  });
});

describe("R-7 · «está corriendo» sólo se afirma con la reserva viva", () => {
  it("con reserva viva dice que corre y no ofrece botón", () => {
    const v = vista({
      reevaluation: { enabled: false, required: false, analysis: "never", inFlight: true, blockers: ["Ya hay una evaluación en curso"], reason: null },
    });
    const now = deriveNowAction(inp(v, true, true));
    expect(now.kind).toBe("esperando_analisis");
    expect(now.label).toBe("El análisis está corriendo");
    expect(now.actionable).toBe(false);
  });

  it("sin reserva NO promete que corre: lo dice y ofrece la re-evaluación", () => {
    const v = vista({
      reevaluation: { enabled: true, required: false, analysis: "never", inFlight: false, blockers: [], reason: null },
    });
    const now = deriveNowAction(inp(v, true, true));
    expect(now.kind).toBe("esperando_analisis");
    expect(now.label).toBe("El análisis no está en curso");
    expect(now.actionable).toBe(true);
  });
});
