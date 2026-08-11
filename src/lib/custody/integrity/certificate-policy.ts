/**
 * Política de emisión documental. Módulo puro.
 *
 * REVISIÓN 3. El certificado exige, además de todo lo anterior, que la decisión
 * sea internamente coherente (actor, sesión, fecha, permiso exacto, estados) y
 * que la ATESTACIÓN de cadena siga vigente y vinculada a las evidencias
 * comparadas. `eventsChecked` debe ser entero positivo, no simplemente `> 0`.
 */

import { isAttestationCurrent } from "./chain";
import {
  CUSTODY_DECISION_PERMISSION,
  type ChainVerification,
  type HumanDecisionRecord,
  type IntegrityAssessment,
  type IntegrityCaseState,
} from "./types";
import { isFiniteInRange, isIdList, isIsoInstant, isNonEmptyId, isPositiveInt } from "./validation";

export type DocumentKind = "certificate" | "acta_inspeccion";

export type CertificateBlocker =
  | "CHAIN_NOT_VERIFIED"
  | "CHAIN_EVENTS_NOT_POSITIVE_INT"
  | "CHAIN_ATTESTATION_STALE"
  | "EVIDENCE_INVALID"
  | "EVIDENCE_NOT_LINKED"
  | "ASSESSMENT_NOT_OK"
  | "EXECUTION_NOT_REAL"
  | "VERDICT_NOT_MATCHING"
  | "CONFIDENCE_NOT_NUMERIC"
  | "NO_HUMAN_DECISION"
  | "DECISION_NOT_RELEASE"
  | "DECISION_STATE_INCOHERENT"
  | "DECISION_CLIENT_MISMATCH"
  | "DECISION_PERMISSION_INVALID"
  | "DECISION_ACTOR_INVALID"
  | "DECISION_TIMESTAMP_INVALID"
  | "DECISION_REASON_TOO_SHORT"
  | "NO_INSPECTION_EVIDENCE"
  | "INSPECTION_SET_NOT_CANONICAL"
  | "DECISION_CHAIN_HEAD_MISMATCH"
  | "STATE_NOT_RELEASED"
  | "CLIENT_MISMATCH";

export interface CertificateContext {
  state: IntegrityCaseState;
  caseClientId: string;
  requesterClientId: string;
  evidenceOk: boolean;
  evidenceEventIds: readonly string[];
  chain: ChainVerification | null;
  assessment: IntegrityAssessment | null;
  decision: HumanDecisionRecord | null;
  /**
   * Conjunto de inspección REVALIDADO para este caso. El certificado no se
   * conforma con que existan IDs: exige que sean exactamente estos.
   */
  canonicalInspectionEvidenceIds: readonly string[];
  /** Head vigente al emitir. La atestación debe seguir describiéndolo. */
  currentChainHead: string | null;
  issuedAt: string;
}

export interface CertificateEligibility {
  document: DocumentKind;
  blockers: CertificateBlocker[];
}

export const SANDBOX_NOTICE = "SANDBOX · DATOS SINTÉTICOS · SIN VALOR PROBATORIO";

export function evaluateCertificateEligibility(ctx: CertificateContext): CertificateEligibility {
  const blockers: CertificateBlocker[] = [];

  if (ctx.caseClientId !== ctx.requesterClientId) blockers.push("CLIENT_MISMATCH");
  if (ctx.evidenceOk !== true) blockers.push("EVIDENCE_INVALID");

  if (!ctx.chain || ctx.chain.status !== "verified") {
    blockers.push("CHAIN_NOT_VERIFIED");
  } else {
    const att = ctx.chain.attestation;
    if (!isPositiveInt(att.eventsChecked)) blockers.push("CHAIN_EVENTS_NOT_POSITIVE_INT");
    const covered = new Set(att.verifiedEventIds);
    if (ctx.evidenceEventIds.length === 0 || ctx.evidenceEventIds.some((id) => !covered.has(id))) {
      blockers.push("EVIDENCE_NOT_LINKED");
    }
    if (!isAttestationCurrent(att, ctx.currentChainHead, ctx.issuedAt)) {
      blockers.push("CHAIN_ATTESTATION_STALE");
    }
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

  const d = ctx.decision;
  if (!d) {
    blockers.push("NO_HUMAN_DECISION");
  } else {
    if (d.decision !== "release") blockers.push("DECISION_NOT_RELEASE");
    if (d.newState !== "RELEASED" || d.previousState !== "REVIEW_REQUIRED") {
      blockers.push("DECISION_STATE_INCOHERENT");
    }
    if (d.clientId !== ctx.caseClientId) blockers.push("DECISION_CLIENT_MISMATCH");
    if (d.permission !== CUSTODY_DECISION_PERMISSION) blockers.push("DECISION_PERMISSION_INVALID");
    if (!isNonEmptyId(d.actorUserId) || !isNonEmptyId(d.actorSessionId) || !isNonEmptyId(d.actorRole)) {
      blockers.push("DECISION_ACTOR_INVALID");
    }
    if (!isIsoInstant(d.decidedAt)) blockers.push("DECISION_TIMESTAMP_INVALID");
    if (typeof d.reason !== "string" || d.reason.trim().length < 10) {
      blockers.push("DECISION_REASON_TOO_SHORT");
    }
    // 🔴 R4-2: el head de la decisión debe coincidir con la atestación Y con el
    // head vigente, y la atestación debe seguir vigente en AMBOS instantes.
    const attested = ctx.chain?.status === "verified" ? ctx.chain.attestation : null;
    if (
      !isNonEmptyId(d.chainHeadAtDecision) ||
      !attested ||
      d.chainHeadAtDecision !== attested.chainHead ||
      d.chainHeadAtDecision !== ctx.currentChainHead ||
      !isAttestationCurrent(attested, ctx.currentChainHead, d.decidedAt) ||
      !isAttestationCurrent(attested, ctx.currentChainHead, ctx.issuedAt)
    ) {
      blockers.push("DECISION_CHAIN_HEAD_MISMATCH");
    }

    if (!isIdList(d.inspectionEvidenceIds)) {
      blockers.push("NO_INSPECTION_EVIDENCE");
    } else if (!isIdList(ctx.canonicalInspectionEvidenceIds)) {
      blockers.push("INSPECTION_SET_NOT_CANONICAL");
    } else {
      const declared = [...d.inspectionEvidenceIds].sort();
      const canonical = [...ctx.canonicalInspectionEvidenceIds].sort();
      if (declared.length !== canonical.length || declared.some((v, i) => v !== canonical[i])) {
        blockers.push("INSPECTION_SET_NOT_CANONICAL");
      }
    }
  }

  if (ctx.state !== "RELEASED") blockers.push("STATE_NOT_RELEASED");

  return { document: blockers.length === 0 ? "certificate" : "acta_inspeccion", blockers };
}

/**
 * Etiqueta de la magnitud del modelo. Impide volver a escribir «nivel de
 * coincidencia N%» sobre la autoconfianza del modelo.
 */
export function formatModelConfidence(value: number | null): string {
  if (!isFiniteInRange(value, 0, 1)) return "confianza del modelo: no disponible";
  return `confianza declarada por el modelo: ${(value * 100).toFixed(1)}% (no es similitud visual ni probabilidad de daño)`;
}
