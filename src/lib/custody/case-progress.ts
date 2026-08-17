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
 */

import type { CustodyCaseView } from "@/lib/custody/case-presentation";

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
  /** «PASO 4 DE 5 · INSPECCIÓN FÍSICA Y DECISIÓN» */
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

export interface ProgressInput {
  view: CustodyCaseView;
  tieneIngreso: boolean;
  tieneEgreso: boolean;
}

/**
 * En qué paso está el caso.
 *
 * Se deriva del ESTADO y de la evidencia registrada, no de una máquina de
 * estados nueva: cualquier discrepancia entre esta barra y lo que el caso
 * permite hacer sería una pantalla que miente.
 */
export function deriveCaseProgress(input: ProgressInput): CaseProgress {
  const { view, tieneIngreso, tieneEgreso } = input;
  const decidido = view.decision !== null;
  const liberado = view.state === "RELEASED";
  const cuarentenado = view.state === "QUARANTINED";

  let current: number;
  if (liberado) current = 5;
  else if (cuarentenado) current = 4;
  else if (decidido) current = 5;
  else if (!tieneIngreso) current = 1;
  else if (!tieneEgreso) current = 2;
  else if (view.ai.executed !== true) current = 3;
  else current = 4;

  // El rótulo del paso 4 cambia cuando la concordancia exige mirar el bien:
  // no es lo mismo «decidí» que «andá, miralo y después decidí».
  const exigeInspeccion =
    view.state === "HOLD" || (view.ai.concordance?.verdict === "BAJA");
  const rotulo4 = exigeInspeccion ? "Inspección física y decisión" : "Decisión del encargado";

  const steps: ProgressStep[] = PASOS.map((label, i) => {
    const index = i + 1;
    const propio = index === 4 ? rotulo4 : label;
    let state: StepState;
    if (cuarentenado && index >= 4) state = index === 4 ? "blocked" : "pending";
    else if (index < current) state = "done";
    else if (index === current) state = liberado && index === 5 ? "done" : "current";
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
  const { view, tieneIngreso, tieneEgreso } = input;

  if (view.state === "QUARANTINED") {
    return {
      kind: "cerrado",
      label: "La unidad está en cuarentena",
      help: "No sale del depósito y no se emite POD. La decisión ya quedó registrada en la cadena.",
      actionable: false,
    };
  }

  if (view.state === "RELEASED") {
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

  if (view.ai.executed !== true) {
    return {
      kind: "esperando_analisis",
      label: "El análisis está corriendo",
      help: "Corre solo al quedar registradas las dos fotos. No hace falta pedirlo.",
      actionable: false,
    };
  }

  // D-4 · acá es donde las capturas decían «quedó por debajo del umbral». Se
  // dice lo mismo sin el corte: qué exige la concordancia, no contra qué.
  if (view.inspection.enabled && view.inspection.eligible === 0 &&
      view.ai.concordance?.verdict === "BAJA") {
    return {
      kind: "inspeccion",
      label: "Registrar inspección física",
      help:
        "La comparación no fue conforme según los estándares internacionales de medición " +
        "del mercado. Andá a la unidad, revisala y sacá una foto de la inspección. " +
        "Recién después vas a poder decidir.",
      actionable: true,
    };
  }

  return {
    kind: "decidir",
    label: "Mirá las dos fotos y decidí",
    help:
      "La comparación no encontró diferencias, pero la decisión sigue siendo tuya. " +
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
 * que lo presenta como una lista de cinco condiciones concretas, que es como el
 * operario la piensa: cuatro tildes y una cosa por hacer.
 */
export function deriveDecisionChecklist(input: ProgressInput): ChecklistItem[] {
  const { view, tieneIngreso, tieneEgreso } = input;
  const analisis = view.ai.executed === true;
  const cadena = view.reevaluation.analysis !== "stale";
  const inspeccion = view.inspection.eligible > 0;
  const exigeInspeccion = view.ai.concordance?.verdict === "BAJA" || view.state === "HOLD";

  const items: ChecklistItem[] = [
    { label: "Foto de ingreso registrada", done: tieneIngreso },
    { label: "Foto de egreso registrada", done: tieneEgreso },
    { label: "Análisis ejecutado", done: analisis },
    { label: "Cadena de custodia verificada", done: cadena },
  ];

  if (exigeInspeccion) {
    items.push({
      label: inspeccion ? "Inspección física registrada" : "Falta la foto de inspección física",
      done: inspeccion,
      hint: inspeccion ? undefined : "Es el único paso que queda. Registrala arriba.",
    });
  }
  return items;
}
