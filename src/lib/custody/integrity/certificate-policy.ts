/**
 * Política de emisión documental. Módulo puro.
 *
 * REVISIÓN 3. El certificado exige, además de todo lo anterior, que la decisión
 * sea internamente coherente (actor, sesión, fecha, permiso exacto, estados) y
 * que la ATESTACIÓN de cadena estuviera vigente y vinculada a las evidencias
 * comparadas. `eventsChecked` debe ser entero positivo, no simplemente `> 0`.
 *
 * REVISIÓN 4 (V4-bis · decisión firmada de Dirección). Un certificado certifica
 * UN MOMENTO: la liberación. La verificación se hace CONTRA EL TESTIGO —la
 * punta que la decisión atestó (`chainHeadAtDecision`)— y en EL INSTANTE de esa
 * decisión (`decidedAt`), nunca contra la punta viva ni contra la hora de
 * emisión. El avance operativo posterior a la liberación (pod, entrega,
 * entregado, foto_entrega, en_transito) no es adulteración y no degrada el
 * documento; de la adulteración se ocupa la verificación de cadena completa
 * (`verify_custody_chain_v2`): una cadena rota deja la atestación viva sin
 * verificar y el documento degrada a acta por su propio camino.
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
  /**
   * Head vigente al emitir. Desde la REVISIÓN 4 es INFORMATIVO: la política no
   * lo compara — el certificado se verifica contra el testigo de la decisión y
   * sobrevive al avance operativo posterior. Se conserva en el contexto porque
   * el armador (la acción de documento) lo transporta para trazabilidad.
   */
  currentChainHead: string | null;
  /** Hora de emisión. También informativa desde la REVISIÓN 4 (ver arriba). */
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
    // REVISIÓN 4: la vigencia se mide EN EL MOMENTO QUE EL DOCUMENTO CERTIFICA
    // —la decisión— y contra el TESTIGO que ella atestó. Sin decisión no hay
    // momento certificable: fail-closed (y NO_HUMAN_DECISION bloquea aparte).
    const witnessHead = ctx.decision?.chainHeadAtDecision ?? null;
    const witnessInstant = ctx.decision?.decidedAt ?? null;
    if (witnessInstant === null || !isAttestationCurrent(att, witnessHead, witnessInstant)) {
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
    // 🔴 R4-2 · REVISIÓN 4: el head de la decisión debe coincidir con el de la
    // ATESTACIÓN que la sostuvo, y esa atestación debe haber estado vigente EN
    // EL INSTANTE DE DECIDIR. La punta viva y la hora de emisión no participan:
    // el certificado certifica el momento de la liberación y sobrevive a los
    // eventos operativos posteriores.
    const attested = ctx.chain?.status === "verified" ? ctx.chain.attestation : null;
    if (
      !isNonEmptyId(d.chainHeadAtDecision) ||
      !attested ||
      d.chainHeadAtDecision !== attested.chainHead ||
      !isAttestationCurrent(attested, d.chainHeadAtDecision, d.decidedAt)
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
