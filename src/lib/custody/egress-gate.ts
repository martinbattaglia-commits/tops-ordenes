/**
 * PUERTA DE EGRESO · LA MÁQUINA DE ESTADOS · S2-3 · Adenda N.º 2 §4.2
 *
 * La contraparte de `physical-ingress.ts`. Hasta este bloque el circuito tenía
 * entrada y no tenía salida: la foto de egreso se podía adjuntar —el par
 * `despacho`/`foto_egreso` ya estaba admitido— pero **no había ninguna puerta**
 * que la exigiera, la comparara y detuviera el despacho. El contrato de
 * cableado lo registra como `NO EXISTE` (§2 fila 10), con la verificación
 * negativa: cero menciones de custodia en picking y packing.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * LA REGLA QUE GOBIERNA TODO ESTE MÓDULO
 * ══════════════════════════════════════════════════════════════════════════
 *
 *                      «LA IA ALERTA; NO DECIDE.»
 *
 * Es el requisito, textual. Y tiene una consecuencia que hay que escribir,
 * porque es la que define la máquina de estados:
 *
 *   **El camino feliz TAMBIÉN pasa por revisión humana.**
 *
 * Si con concordancia alta el caso se liberara solo, quien libera la mercadería
 * sería la IA. Que el resultado sea «coincide» no lo convierte en decisión
 * humana: lo convierte en una decisión automática con buen pronóstico. La
 * Adenda manda revisión REFORZADA por debajo del criterio; no dispensa de la
 * decisión humana por encima de él. Lo que cambia con la concordancia no es SI
 * decide una persona, sino CUÁNTO le cuesta:
 *
 *   · concordancia suficiente → el inspector revisa y libera (motivo normal);
 *   · concordancia insuficiente, o banderas de daño → además hace falta foto de
 *     inspección física y el motivo reforzado; la liberación es un OVERRIDE.
 *
 * En los dos casos hay una persona que firma. En ninguno libera el modelo.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * LOS NIVELES MANDAN POR ENCIMA DE ESTE MÓDULO
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Contrato §9.8, definición de Dirección. **NIVEL 1 no pasa por nada de esto**:
 * sin foto de egreso, sin IA, sin cuarentena, sin certificado. Su ausencia no
 * bloquea recepción, carga, reserva ni despacho.
 *
 * Y la línea roja: **ninguna excepción del nivel 1 afloja el nivel 2**. Por eso
 * el nivel es lo PRIMERO que se evalúa acá y la salida del nivel 1 es total —
 * no «con menos requisitos», sino fuera de la puerta— mientras que la rama del
 * nivel 2 no tiene ni una condición menos que antes de este bloque.
 */

/**
 * ─── POR QUÉ ESTE MÓDULO ESTÁ SEPARADO DE `physical-egress.ts` ────────────
 *
 * Por la MISMA razón que `physical-ingress.ts` se extrajo de la server action,
 * y el módulo la aprendió dos veces. La máquina de estados es pura y tiene que
 * poder probarse sin PostgreSQL, sin sesión y sin Storage. Mientras vivió junto
 * a `registerEgressEvidence` arrastraba el cliente de Supabase, `next/cache` y
 * la cadena `server-only` entera, y la suite de pruebas puras no podía ni
 * cargar el archivo.
 *
 * Acá no se importa nada de servidor. Es la regla que hace verificable esta
 * puerta.
 */

import { guidance } from "@/lib/custody/blocker-guidance";
import type { IntegrityCaseState } from "@/lib/custody/integrity/types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Nivel de custodia con el que la unidad INGRESÓ. Nunca se re-deriva. */
export type CustodyLevel = 1 | 2;

/**
 * Lo que el egreso exige, resuelto. No es una opinión de la pantalla: cada
 * campo se corresponde con una condición que la base también aplica.
 */
export interface EgressGateState {
  level: CustodyLevel;
  /** El nivel 1 no lleva foto de egreso. Lo dice la definición, no el flujo. */
  requiresEgressPhoto: boolean;
  /** Hay una decisión humana registrada sobre el caso. */
  humanDecisionRecorded: boolean;
  /**
   * Falta la decisión humana. Es `true` en el camino feliz también: la IA
   * alerta, no decide.
   */
  awaitingHumanDecision: boolean;
  /**
   * La concordancia o las banderas exigen inspección física además de la
   * decisión. Es la ALERTA de la IA — jamás una liberación ni un bloqueo
   * definitivo: el inspector puede liberar igual, como override.
   */
  reinforcedInspectionRequired: boolean;
  /** Despacho habilitado por custodia. */
  dispatchAllowed: boolean;
  /** POD habilitado por custodia. Va junto con el despacho (Adenda §4.2). */
  podAllowed: boolean;
  /** Motivos, YA guiados: qué falta y qué hacer. Vacío si `dispatchAllowed`. */
  blockers: string[];
}

export interface EgressGateInput {
  level: CustodyLevel;
  state: IntegrityCaseState;
  /** Existe el caso de integridad. En nivel 1 es normalmente `false`. */
  caseExists: boolean;
  hasIngressPhoto: boolean;
  hasEgressPhoto: boolean;
  /** Decisión humana registrada, si la hubiera. */
  decision: { kind: "release" | "quarantine" } | null;
  /**
   * La política dejó retenciones vivas sobre el caso — concordancia
   * insuficiente, banderas de daño. Es la ALERTA.
   */
  holdReasons: readonly string[];
  /** Existe el certificado de liberación. Lo resuelve el servidor. */
  releaseCertificateIssued: boolean;
  /** La cadena avanzó después de liberar: la liberación quedó vencida. */
  chainAdvancedAfterRelease?: boolean;
}

/**
 * Las retenciones que convierten la liberación en un override reforzado. No
 * impiden decidir: obligan a mirar el bien antes de firmar.
 */
const REINFORCING_HOLDS: readonly string[] = [
  "BELOW_SIMILARITY_THRESHOLD",
  "NO_CALIBRATED_THRESHOLD",
  "VERDICT_DIFFERENCES",
  "VERDICT_POSSIBLE_DAMAGE",
  "PACKAGING_CHANGED",
  "MISSING_ITEMS_SUSPECTED",
  "DAMAGE_SUSPECTED",
];

/**
 * LA MÁQUINA DE ESTADOS DEL EGRESO. Módulo puro: no lee base, no escribe, no
 * depende de sesión. Se puede probar entera sin PostgreSQL, y es la misma que
 * el gate de la base aplica del otro lado.
 *
 * ─── EL ORDEN DE LAS RAMAS ES LA GARANTÍA ─────────────────────────────────
 *
 * El nivel se resuelve PRIMERO y su salida es total. Ninguna condición del
 * nivel 2 se evalúa para una unidad de nivel 1, y —lo que importa— ninguna
 * excepción escrita para el nivel 1 alcanza a una unidad de nivel 2: están en
 * ramas disjuntas, no en una lista de condiciones con excepciones.
 */
export function evaluateEgressGate(input: EgressGateInput): EgressGateState {
  // ── NIVEL 1 · fuera de la puerta ────────────────────────────────────────
  //
  // No es «nivel 2 con menos requisitos»: es un régimen distinto. Sin foto de
  // egreso, sin IA, sin cuarentena, sin certificado, y sin bloquear nada. La
  // foto de INGRESO, si la hay, es evidencia defensiva y tampoco condiciona.
  if (input.level < 2) {
    return {
      level: 1,
      requiresEgressPhoto: false,
      humanDecisionRecorded: false,
      awaitingHumanDecision: false,
      reinforcedInspectionRequired: false,
      dispatchAllowed: true,
      podAllowed: true,
      blockers: [],
    };
  }

  // ── NIVEL 2 · la puerta completa ────────────────────────────────────────
  const blockers: string[] = [];

  if (!input.caseExists) blockers.push(guidance("CUSTODY_CASE_MISSING"));

  // La foto de egreso es OBLIGATORIA y se pide antes que nada de lo demás: es
  // lo único que el operario puede resolver por sí mismo parado en el depósito.
  if (!input.hasEgressPhoto) blockers.push(guidance("CUSTODY_EGRESS_PHOTO_MISSING"));
  if (!input.hasIngressPhoto) {
    blockers.push(
      "No hay foto de ingreso contra la cual comparar. No despaches esta unidad: avisá a supervisión.",
    );
  }

  const decided = input.decision !== null;
  const released = input.decision?.kind === "release" && input.state === "RELEASED";
  const quarantined = input.decision?.kind === "quarantine" || input.state === "QUARANTINED";

  // La ALERTA de la IA. Se calcula siempre —también con el caso ya decidido—
  // porque describe lo que el inspector tenía que mirar, no lo que resta hacer.
  const reinforced = input.holdReasons.some((r) => REINFORCING_HOLDS.includes(r));

  if (quarantined) {
    blockers.push("La unidad está en cuarentena: no se despacha ni se emite POD.");
  } else if (!decided) {
    // ── EL CAMINO FELIZ TAMBIÉN CAE ACÁ ───────────────────────────────────
    // Con concordancia alta, banderas limpias y las dos fotos cargadas, este
    // bloqueo sigue puesto. Es el que impide que la IA libere sola.
    blockers.push(guidance("CUSTODY_HOLD"));
    if (reinforced) {
      blockers.push(
        "El análisis marcó diferencias: hay que mirar el bien y registrar la foto de inspección física antes de liberar.",
      );
    }
  } else if (!released) {
    blockers.push(guidance("STATE_NOT_RELEASED"));
  } else {
    // Liberado. Restan las dos condiciones documentales del despacho.
    if (!input.releaseCertificateIssued) {
      blockers.push(guidance("CUSTODY_RELEASE_CERTIFICATE_MISSING"));
    }
    if (input.chainAdvancedAfterRelease === true) {
      blockers.push(guidance("CUSTODY_CHAIN_ADVANCED_AFTER_RELEASE"));
    }
  }

  const allowed = blockers.length === 0;
  return {
    level: 2,
    requiresEgressPhoto: true,
    humanDecisionRecorded: decided,
    awaitingHumanDecision: !decided,
    reinforcedInspectionRequired: reinforced,
    dispatchAllowed: allowed,
    podAllowed: allowed,
    blockers: [...new Set(blockers)],
  };
}
