/**
 * §7 VISUAL · DÓNDE ESTÁ PARADO EL OPERARIO, Y QUÉ TIENE QUE HACER AHORA.
 *
 * Módulo PURO: deriva del view-model que ya viaja. No lee base, no decide
 * autoridad, no conoce umbrales. Existe para que la pantalla no calcule nada y
 * para que estas tres derivaciones se puedan probar sin DOM.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * D-4 · EL UMBRAL NO SALE A PANTALLA · POLÍTICA DE EMPRESA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   «El umbral de detección no viaja al cliente ni a la pantalla del operario:
 *    publicar el corte enseña a operar por debajo de él.»
 *
 * Las capturas de la especificación lo mostraban en siete lugares. Ninguno se
 * implementa así. Acá NO aparece —ni puede aparecer— el porcentaje del umbral,
 * la palabra «umbral» con cifra, ni «sobre/bajo el umbral» aunque no lleven
 * número. Lo que sí sale es la CONCORDANCIA con su número real y el veredicto
 * cualitativo, que ya vienen resueltos server-side en `ConcordanceView`.
 *
 * La garantía es estructural y no una convención de redacción: este módulo no
 * recibe `thresholdPercent` porque `AiPanelView` no lo tiene por construcción.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REMEDIACIÓN C4 · GRUPO A · CADA CAMPO SIGNIFICA LO QUE DICE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La primera versión de este módulo leía campos del view-model asumiendo un
 * significado que esos campos NO tienen, y las tres derivaciones definían
 * «exige inspección» de tres formas distintas. Eso producía una pantalla que
 * se contradecía a sí misma y, en dos casos, un bucle del que el operario no
 * podía salir. Las seis instancias, y por qué cada una era falsa:
 *
 *  A-1 · `reevaluation.analysis !== "stale"` se leía como «cadena verificada».
 *        `"never"` tampoco es `"stale"`, así que un caso SIN NINGÚN análisis
 *        mostraba la tilde de verificado. El docblock de `AnalysisFreshness`
 *        advierte literalmente contra esto: son TRES estados, no dos.
 *
 *  A-2 · `inspection.eligible` se leía como «hay foto de inspección». No lo
 *        es: se calcula DESPUÉS de un guard de `wms.custody.decide`
 *        (`actions.ts`), permiso que el operario de depósito no tiene —él
 *        captura con `wms.edit`—. Para él valía 0 SIEMPRE: la pantalla le
 *        pedía registrar la inspección, la registraba, y se lo volvía a pedir.
 *        Para siempre. La señal verdadera es si el TIMELINE tiene el evento
 *        `inspeccion_humana`, que no depende de ningún permiso de decisión, y
 *        entra por `tieneInspeccion`.
 *
 *  A-3 · tres definiciones distintas de «exige inspección». Ahora hay UNA
 *        —`exigeInspeccion`—, derivada una sola vez y consumida por las tres.
 *
 *  A-4 · `ai.executed !== true` se leía como «el análisis está corriendo».
 *        `executed` sólo es `true` con `outcome === "ok"`; hay cuatro outcomes
 *        de FALLO. Un análisis caído anunciaba estar corriendo para siempre:
 *        el segundo bucle. Se distingue por `failureLabel`.
 *
 *  A-5 · `NO_CONCLUYENTE` no se manejaba en ninguna derivación y caía al
 *        default «la comparación no encontró diferencias» —falso: no pudo
 *        comparar—. Tiene su propia acción, que es la que pide su
 *        `requirement`: repetir la foto de egreso.
 *
 *  A-6 · la acción de inspección se ofrecía con `actionable: true` fijo, sin
 *        mirar `inspection.enabled`. Un botón vivo para quien no puede usarlo.
 */

import type { CustodyCaseView } from "@/lib/custody/case-presentation";

// ---------------------------------------------------------------------------
// 0 · LOS HECHOS DEL CASO · UNA LECTURA, UN SIGNIFICADO
// ---------------------------------------------------------------------------

export interface ProgressInput {
  view: CustodyCaseView;
  tieneIngreso: boolean;
  tieneEgreso: boolean;
  /**
   * ¿El timeline registra el evento `inspeccion_humana`?
   *
   * Se pasa desde la página, que ya lo tiene resuelto. NO se deriva de
   * `inspection.eligible`: ver A-2 en el encabezado.
   */
  tieneInspeccion: boolean;
}

/**
 * Todo lo que las tres derivaciones necesitan saber, nombrado por lo que
 * SIGNIFICA y no por el campo del que sale. Se calcula una vez para que las
 * tres no puedan discrepar.
 */
interface CaseFacts {
  decidido: boolean;
  liberado: boolean;
  cuarentenado: boolean;
  /** El análisis corrió y produjo un resultado UTILIZABLE. */
  analisisOk: boolean;
  /** El análisis corrió y FALLÓ. Distinto de «todavía no corrió». */
  analisisFallido: boolean;
  /** La cadena avanzó y dejó el análisis viejo. */
  analisisVencido: boolean;
  /** Las fotos no son comparables: no hay veredicto que sostener. */
  noConcluyente: boolean;
  /** El caso exige mirar el bien antes de decidir. UNA definición. */
  exigeInspeccion: boolean;
  /** La cadena está verificada: hay análisis utilizable y sigue vigente. */
  cadenaVerificada: boolean;
}

function hechos(input: ProgressInput): CaseFacts {
  const { view } = input;
  const analisisOk = view.ai.executed === true;
  // `failureLabel` sólo se completa con un assessment de outcome distinto de
  // `ok`: es la señal de que corrió y falló, y no de que no haya corrido.
  const analisisFallido = !analisisOk && view.ai.failureLabel !== null;
  const analisisVencido = view.reevaluation.analysis === "stale";
  const veredicto = view.ai.concordance?.verdict ?? null;

  return {
    decidido: view.decision !== null,
    liberado: view.state === "RELEASED",
    cuarentenado: view.state === "QUARANTINED",
    analisisOk,
    analisisFallido,
    analisisVencido,
    noConcluyente: veredicto === "NO_CONCLUYENTE",
    exigeInspeccion: view.state === "HOLD" || veredicto === "BAJA",
    cadenaVerificada: analisisOk && !analisisVencido,
  };
}

// ---------------------------------------------------------------------------
// 1 · LA BARRA DE CINCO PASOS
// ---------------------------------------------------------------------------

export type StepState = "done" | "current" | "pending" | "blocked";

export interface ProgressStep {
  /** 1..5 */
  index: number;
  label: string;
  state: StepState;
}

export interface CaseProgress {
  /** Paso vigente, 1..5. */
  current: number;
  total: 5;
  /** «Paso 4 de 5 · Inspección física y decisión» */
  caption: string;
  steps: ProgressStep[];
}

/**
 * Los cinco pasos del circuito, en el orden en que ocurren en el depósito.
 *
 * El tercero —el análisis— nunca es «el paso donde estás»: corre solo al
 * completarse el par y dura lo que dura la llamada. Se muestra igual porque el
 * operario tiene que saber que existe y que no depende de él.
 */
const PASOS = [
  "Foto de ingreso",
  "Foto de egreso",
  "Análisis",
  "Decisión",
  "Entrega y POD",
] as const;

/**
 * En qué paso está el caso.
 *
 * Se deriva del ESTADO y de la evidencia registrada, no de una máquina de
 * estados nueva: cualquier discrepancia entre esta barra y lo que el caso
 * permite hacer sería una pantalla que miente.
 */
export function deriveCaseProgress(input: ProgressInput): CaseProgress {
  const { tieneIngreso, tieneEgreso } = input;
  const h = hechos(input);

  let current: number;
  if (h.liberado) current = 5;
  else if (h.cuarentenado) current = 4;
  else if (h.decidido) current = 5;
  else if (!tieneIngreso) current = 1;
  else if (!tieneEgreso) current = 2;
  else if (!h.analisisOk) current = 3;
  else current = 4;

  // El rótulo del paso 4 cambia cuando la concordancia exige mirar el bien:
  // no es lo mismo «decidí» que «andá, miralo y después decidí».
  const rotulo4 = h.exigeInspeccion ? "Inspección física y decisión" : "Decisión del encargado";

  const steps: ProgressStep[] = PASOS.map((label, i) => {
    const index = i + 1;
    const propio = index === 4 ? rotulo4 : label;
    let state: StepState;
    if (h.cuarentenado && index >= 4) state = index === 4 ? "blocked" : "pending";
    // A-4 · un análisis CAÍDO no está «corriendo»: está trabado, y la barra lo
    // dice en el mismo color con que dice trabado en cualquier otro lado.
    else if (index === 3 && index === current && h.analisisFallido) state = "blocked";
    else if (index < current) state = "done";
    else if (index === current) state = h.liberado && index === 5 ? "done" : "current";
    else state = "pending";
    return { index, label: propio, state };
  });

  const caption = `Paso ${current} de 5 · ${steps[current - 1]?.label ?? ""}`;
  return { current, total: 5, caption, steps };
}

// ---------------------------------------------------------------------------
// 2 · EL BLOQUE `▸ AHORA` · UNA SOLA ACCIÓN VIVA
// ---------------------------------------------------------------------------

export type NowKind =
  | "foto_ingreso"
  | "foto_egreso"
  | "esperando_analisis"
  | "analisis_fallido"
  | "repetir_egreso"
  | "inspeccion"
  | "decidir"
  | "pod"
  | "cerrado";

export interface NowAction {
  kind: NowKind;
  /** Lo que dice el botón, o el título si no hay botón. */
  label: string;
  /** Por qué, en lenguaje llano. Nunca nombra el umbral (D-4). */
  help: string;
  /** `true` cuando hay un botón vivo; `false` cuando sólo se informa. */
  actionable: boolean;
}

/**
 * LA única acción viva del caso.
 *
 * Es lo que convierte una pantalla de datos en una pantalla de trabajo: el
 * operario abre el caso y ve UNA cosa para hacer, no siete paneles compitiendo.
 * El resto de la pantalla sigue existiendo, atenuado.
 */
export function deriveNowAction(input: ProgressInput): NowAction {
  const { view, tieneIngreso, tieneEgreso, tieneInspeccion } = input;
  const h = hechos(input);

  if (h.cuarentenado) {
    return {
      kind: "cerrado",
      label: "La unidad está en cuarentena",
      help: "No sale del depósito y no se emite POD. La decisión ya quedó registrada en la cadena.",
      actionable: false,
    };
  }

  if (h.liberado) {
    return {
      kind: "pod",
      label: "Generar POD de entrega",
      help:
        "El POD nombra al depositante y a la unidad, y lleva impreso el mismo QR de siempre. " +
        "La página de ese QR ya muestra la historia completa.",
      actionable: !view.podBlocked,
    };
  }

  if (!tieneIngreso) {
    return {
      kind: "foto_ingreso",
      label: "Sacar foto de ingreso",
      help:
        "Fotografiá el embalaje antes de abrirlo. Buscá golpes, humedad o aperturas. " +
        "El servidor verifica el tipo real del archivo y recalcula el hash antes de aceptarlo.",
      actionable: view.capture.enabled,
    };
  }

  if (!tieneEgreso) {
    return {
      kind: "foto_egreso",
      label: "Sacar foto de egreso",
      help:
        "Repetí los mismos ángulos de la foto de ingreso, que tenés al lado para comparar. " +
        "Buena luz y foco. El análisis corre solo cuando la registres.",
      actionable: view.capture.enabled,
    };
  }

  // A-4 · CORRIÓ Y FALLÓ ≠ TODAVÍA NO CORRIÓ. Decirle «está corriendo» a un
  // análisis caído deja al operario esperando algo que no va a llegar nunca.
  if (h.analisisFallido) {
    return {
      kind: "analisis_fallido",
      label: "Volver a pedir el análisis",
      help:
        `El análisis no pudo completarse (${view.ai.failureLabel}). No es un resultado: ` +
        "es una comparación que no llegó a hacerse. Pedila de nuevo; las fotos ya están registradas.",
      actionable: view.reevaluation.enabled,
    };
  }

  if (!h.analisisOk) {
    return {
      kind: "esperando_analisis",
      label: "El análisis está corriendo",
      help: "Corre solo al quedar registradas las dos fotos. No hace falta pedirlo.",
      actionable: false,
    };
  }

  // A-5 · NO CONCLUYENTE tiene su propia salida, y es la que pide su
  // `requirement`: si las fotos no son comparables no hay nada que inspeccionar
  // todavía, hay que volver a sacar la de egreso.
  if (h.noConcluyente) {
    return {
      kind: "repetir_egreso",
      label: "Repetir la foto de egreso",
      help:
        "Las dos fotos no resultaron comparables, así que la comparación no arroja un " +
        "resultado que puedas usar. Repetí la de egreso con los mismos ángulos de la de " +
        "ingreso, buena luz y foco.",
      actionable: view.capture.enabled,
    };
  }

  // D-4 · acá es donde las capturas decían «quedó por debajo del umbral». Se
  // dice lo mismo sin el corte: qué exige la concordancia, no contra qué.
  //
  // A-2 · «¿ya está registrada?» se pregunta al TIMELINE (`tieneInspeccion`),
  // no a `inspection.eligible`, que depende de un permiso que el operario que
  // saca la foto no tiene.
  // A-6 · y el botón se ofrece vivo sólo si de verdad se puede usar.
  if (h.exigeInspeccion && !tieneInspeccion) {
    return {
      kind: "inspeccion",
      label: "Registrar inspección física",
      help:
        "La comparación no fue conforme según los estándares internacionales de medición " +
        "del mercado. Andá a la unidad, revisala y sacá una foto de la inspección. " +
        "Recién después vas a poder decidir.",
      actionable: view.inspection.enabled,
    };
  }

  return {
    kind: "decidir",
    label: "Mirá las dos fotos y decidí",
    help: h.exigeInspeccion
      ? "La inspección física ya está registrada. La decisión es tuya: no existe " +
        "liberación automática por porcentaje."
      : "La comparación no encontró diferencias, pero la decisión sigue siendo tuya. " +
        "No existe liberación automática por porcentaje.",
    actionable: view.release.enabled || view.quarantine.enabled,
  };
}

// ---------------------------------------------------------------------------
// 3 · EL CHECKLIST «PARA PODER DECIDIR»
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  label: string;
  done: boolean;
  /** Sólo en el ítem que falta: qué hacer. */
  hint?: string;
}

/**
 * Qué falta para poder decidir, en positivo.
 *
 * No sustituye a `release.blockers` —que sigue diciendo el motivo exacto— sino
 * que lo presenta como una lista de condiciones concretas, que es como el
 * operario la piensa: unas cuantas tildes y una cosa por hacer.
 */
export function deriveDecisionChecklist(input: ProgressInput): ChecklistItem[] {
  const { tieneIngreso, tieneEgreso, tieneInspeccion } = input;
  const h = hechos(input);

  const items: ChecklistItem[] = [
    { label: "Foto de ingreso registrada", done: tieneIngreso },
    { label: "Foto de egreso registrada", done: tieneEgreso },
    {
      label: "Análisis ejecutado",
      done: h.analisisOk,
      // A-4 · si falló, el ítem dice por qué está sin tilde en vez de dejar al
      // operario suponiendo que todavía no le tocó.
      hint: h.analisisOk ? undefined : h.analisisFallido
        ? "El análisis no pudo completarse. Pedilo de nuevo."
        : undefined,
    },
    // A-1 · «nunca se ejecutó» NO es «al día». La tilde exige un análisis
    // utilizable Y vigente; cualquier otra cosa deja el ítem abierto.
    {
      label: "Cadena de custodia verificada",
      done: h.cadenaVerificada,
      hint: h.cadenaVerificada
        ? undefined
        : h.analisisVencido
          ? "La cadena avanzó y dejó el análisis desactualizado. Volvé a pedirlo."
          : "Todavía no hay un análisis utilizable sobre esta cadena.",
    },
  ];

  if (h.exigeInspeccion) {
    items.push({
      label: tieneInspeccion ? "Inspección física registrada" : "Falta la foto de inspección física",
      done: tieneInspeccion,
      hint: tieneInspeccion ? undefined : "Es el único paso que queda. Registrala arriba.",
    });
  }
  return items;
}
