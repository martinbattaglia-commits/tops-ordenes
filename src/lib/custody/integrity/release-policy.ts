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
  | "NO_HUMAN_INSPECTION_EVIDENCE"
  | "REASON_TOO_SHORT";

export const MIN_REASON_LENGTH = 10;

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
}

export function evaluateReleaseEligibility(ctx: ReleaseEligibilityContext): ReleaseEligibility {
  const blockers: ReleaseBlocker[] = [];

  if (ctx.state !== "REVIEW_REQUIRED") blockers.push("STATE_NOT_REVIEWABLE");

  // Frontera sellada: EXACTAMENTE el conjunto liberable, ni más ni menos.
  if (!isExactSet(ctx.holdReasons, RELEASABLE_HOLD_SET)) blockers.push("HOLD_SET_NOT_EXACT");

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
  }

  // Debe ser una lista real de IDs, sin duplicados y no vacía.
  if (!isIdList(ctx.canonicalInspectionEvidenceIds)) {
    blockers.push("NO_HUMAN_INSPECTION_EVIDENCE");
  }

  if (typeof ctx.reason !== "string" || ctx.reason.trim().length < MIN_REASON_LENGTH) {
    blockers.push("REASON_TOO_SHORT");
  }

  return { allowed: blockers.length === 0, blockers };
}
