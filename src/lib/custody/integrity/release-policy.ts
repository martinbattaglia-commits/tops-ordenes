/**
 * Política CONSERVADORA de liberación. Módulo puro.
 *
 * REVISIÓN 3. La frontera está SELLADA: `holdReasons` debe ser **exactamente**
 * `["NO_CALIBRATED_THRESHOLD"]`. Lista vacía, motivo ausente, duplicado, motivo
 * adicional o forma malformada en runtime → no se libera.
 *
 * La CUARENTENA no está sujeta a esta política: confirmar un problema desde
 * `REVIEW_REQUIRED` siempre es admisible. Equivocarse reteniendo es barato;
 * equivocarse liberando, no.
 */

import type { ChainVerification, HoldReason, IntegrityAssessment, IntegrityCaseState } from "./types";
import { RELEASABLE_HOLD_SET } from "./types";
import { isExactSet, isFiniteInRange, isIdList, isPositiveInt } from "./validation";

export type ReleaseBlocker =
  | "STATE_NOT_REVIEWABLE"
  | "HOLD_SET_NOT_EXACT"
  | "EVIDENCE_NOT_VALID"
  | "CHAIN_NOT_VERIFIED"
  | "CHAIN_EVENTS_NOT_POSITIVE_INT"
  | "ASSESSMENT_NOT_OK"
  | "EXECUTION_NOT_REAL"
  | "VERDICT_NOT_MATCHING"
  | "CONFIDENCE_NOT_NUMERIC"
  | "SCORE_BELOW_THRESHOLD"
  | "DAMAGE_FLAGS_PRESENT"
  | "NO_HUMAN_INSPECTION_EVIDENCE"
  | "REASON_TOO_SHORT";

export const MIN_REASON_LENGTH = 10;

/**
 * Liberar un caso que la política dejó en HOLD es un OVERRIDE humano, y la RPC
 * lo trata como tal: `decide_custody_integrity_v2` exige allí un motivo de al
 * menos 20 caracteres (rama `human_override`). Este módulo replica ese piso en
 * lugar de aceptar 10 y dejar que la RPC devuelva un error crudo al inspector.
 */
export const MIN_OVERRIDE_REASON_LENGTH = 20;

export interface ReleaseEligibilityContext {
  state: IntegrityCaseState;
  holdReasons: readonly HoldReason[];
  evidenceOk: boolean;
  chain: ChainVerification | null;
  assessment: IntegrityAssessment | null;
  canonicalInspectionEvidenceIds: readonly string[];
  reason: string;
}

export interface ReleaseEligibility {
  allowed: boolean;
  blockers: ReleaseBlocker[];
  /**
   * Condiciones que NO impiden liberar pero que convierten la liberación en un
   * override humano explícito. Van separadas de `blockers` a propósito: si el
   * puntaje bajo bloqueara, el caso por debajo del umbral no podría liberarse
   * nunca y sería la IA la que decide por omisión — justo lo que el contrato
   * prohíbe. Y si no se declarara, el override sería indistinguible de una
   * liberación limpia.
   */
  overrideReasons: ReleaseBlocker[];
}

export function evaluateReleaseEligibility(ctx: ReleaseEligibilityContext): ReleaseEligibility {
  const blockers: ReleaseBlocker[] = [];
  const overrideReasons: ReleaseBlocker[] = [];

  const productive = typeof ctx.assessment?.thresholdPercent === "number";
  // Liberar desde HOLD es la rama `human_override` de la RPC: existe, es
  // legítima y exige más del inspector, no menos.
  const isOverride = productive && ctx.state === "HOLD";
  if (ctx.state !== "REVIEW_REQUIRED" && !isOverride) {
    blockers.push("STATE_NOT_REVIEWABLE");
  }

  // El legado conserva su frontera sellada. En v2 la DB diferencia una
  // evaluación limpia de un HOLD que sólo puede liberar un admin mediante
  // override humano reforzado; ambos exigen inspección posterior.
  if (!productive && !isExactSet(ctx.holdReasons, RELEASABLE_HOLD_SET)) {
    blockers.push("HOLD_SET_NOT_EXACT");
  }

  if (ctx.evidenceOk !== true) blockers.push("EVIDENCE_NOT_VALID");

  if (!ctx.chain || ctx.chain.status !== "verified") {
    blockers.push("CHAIN_NOT_VERIFIED");
  } else if (!isPositiveInt(ctx.chain.attestation.eventsChecked)) {
    blockers.push("CHAIN_EVENTS_NOT_POSITIVE_INT");
  }

  if (!ctx.assessment || ctx.assessment.outcome !== "ok") {
    blockers.push("ASSESSMENT_NOT_OK");
  } else {
    if (ctx.assessment.provenance.executionMode !== "real") blockers.push("EXECUTION_NOT_REAL");
    if (ctx.assessment.verdict !== "coincide") blockers.push("VERDICT_NOT_MATCHING");
    if (!isFiniteInRange(ctx.assessment.modelConfidence, 0, 1)) {
      blockers.push("CONFIDENCE_NOT_NUMERIC");
    }
    // El umbral y las banderas se evalúan SIEMPRE que la política sea
    // productiva; lo que cambia con el estado es si el hallazgo bloquea o se
    // declara. Antes vivían dentro de `state === "REVIEW_REQUIRED"`, así que un
    // caso por debajo del umbral —que la DB deja en HOLD— salía sin ningún
    // bloqueo ni señal: el control que justifica la feature no se aplicaba en
    // la capa que lo muestra.
    if (productive) {
      const destino = isOverride ? overrideReasons : blockers;
      if (ctx.assessment.thresholdResult !== "ABOVE_OR_EQUAL"
          || typeof ctx.assessment.similarityScore !== "number"
          || ctx.assessment.similarityScore < ctx.assessment.thresholdPercent!) {
        destino.push("SCORE_BELOW_THRESHOLD");
      }
      if (ctx.assessment.packagingChanged !== false
          || ctx.assessment.missingItemsSuspected !== false
          || ctx.assessment.damageSuspected !== false) {
        destino.push("DAMAGE_FLAGS_PRESENT");
      }
    }
  }

  // Debe ser una lista real de IDs, sin duplicados y no vacía.
  if (!isIdList(ctx.canonicalInspectionEvidenceIds)) {
    blockers.push("NO_HUMAN_INSPECTION_EVIDENCE");
  }

  // El override pide el mismo piso que la RPC, no el de una liberación limpia.
  const minReason = isOverride ? MIN_OVERRIDE_REASON_LENGTH : MIN_REASON_LENGTH;
  if (typeof ctx.reason !== "string" || ctx.reason.trim().length < minReason) {
    blockers.push("REASON_TOO_SHORT");
  }

  return { allowed: blockers.length === 0, blockers, overrideReasons };
}
