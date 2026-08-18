/**
 * Adaptador en memoria — sandbox y tests. NO exportado por el barrel público.
 *
 * R3-1 · FRONTERA SELLADA. El repositorio ya no confía en objetos compuestos
 * por el caller. Exige que la validación de evidencia, la verificación de
 * cadena, la evaluación y la prueba de inspección sean **artefactos sellados
 * por el dominio y atados a este caso** (`sealed.ts`), y además **re-deriva**
 * los hechos críticos en vez de creerle al registro.
 *
 * R3-3 · `chainHeadAtDecision` debe coincidir a la vez con el head de la
 * atestación y con el head vigente usado durante la decisión.
 *
 * R3-4 · La reserva es un **lease con vencimiento**: si una evaluación muere
 * después de reservar, el caso no queda bloqueado para siempre.
 */

import { readEvaluationOutcome, readInspectionProof } from "./canonical";
import { isAttestationCurrent } from "./chain";
import type {
  ApplyDecisionCasInput,
  CasResult,
  IntegrityCaseRepository,
  RecordAssessmentInput,
  ReserveCaseInput,
  ReserveResult,
} from "./ports";
import { evaluateReleaseEligibility } from "./release-policy";
import { caseBinding } from "./sealed";
import {
  CUSTODY_DECISION_PERMISSION,
  DECISION_VALUES,
  TERMINAL_STATES,
  freezeCase,
  isTerminal,
  sameEntity,
  type IntegrityCase,
  type IntegrityCaseState,
} from "./types";
import { isIdList, isIsoInstant, isNonEmptyId, isPositiveInt, msBetween } from "./validation";

export class InMemoryIntegrityCaseRepository implements IntegrityCaseRepository {
  private readonly cases = new Map<string, IntegrityCase>();

  /**
   * Lease con vencimiento. Reclama sólo si el lease venció y no hay evaluación
   * registrada — un caso ya evaluado no vuelve a reclamarse por esta vía.
   */
  async reserveCase(input: ReserveCaseInput): Promise<ReserveResult> {
    const existing = this.cases.get(input.caseId);
    if (!existing) {
      const created: IntegrityCase = {
        caseId: input.caseId,
        version: 1,
        evaluationLease: { holder: input.holder, until: input.leaseUntil },
        entity: input.entity,
        selector: input.selector,
        state: "PENDING_EVIDENCE",
        holdReasons: [],
        evidence: { ingress: null, egress: null },
        chain: null,
        assessment: null,
        decision: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      this.cases.set(input.caseId, structuredClone(created));
      return { ok: true, case: freezeCase(created), claimed: true };
    }

    if (existing.entity.clientId !== input.entity.clientId) {
      return { ok: false, failure: "NOT_FOUND" };
    }

    const lease = existing.evaluationLease;
    const leaseAlive =
      lease !== null &&
      isIsoInstant(lease.until) &&
      isIsoInstant(input.createdAt) &&
      msBetween(input.createdAt, lease.until) > 0;

    // Lease vencido y sin evaluación registrada → reclaim seguro.
    if (!leaseAlive && existing.assessment === null && !isTerminal(existing.state)) {
      const reclaimed: IntegrityCase = structuredClone({
        ...existing,
        evaluationLease: { holder: input.holder, until: input.leaseUntil },
        updatedAt: input.createdAt,
      });
      this.cases.set(input.caseId, reclaimed);
      return { ok: true, case: freezeCase(reclaimed), claimed: true };
    }

    return { ok: true, case: freezeCase(existing), claimed: false };
  }

  async findById(caseId: string, clientId: string): Promise<IntegrityCase | null> {
    const found = this.cases.get(caseId);
    if (!found || found.entity.clientId !== clientId) return null;
    return freezeCase(found);
  }

  async recordAssessment(input: RecordAssessmentInput): Promise<CasResult> {
    if (!isPositiveInt(input.expectedVersion)) return { ok: false, failure: "VERSION_CONFLICT" };

    const found = this.cases.get(input.caseId);
    if (!found || found.entity.clientId !== input.clientId) {
      return { ok: false, failure: "NOT_FOUND" };
    }
    if (isTerminal(found.state)) return { ok: false, failure: "ALREADY_DECIDED" };
    if (found.version !== input.expectedVersion) return { ok: false, failure: "VERSION_CONFLICT" };

    // 🔴 R4-1: el binding se RECALCULA desde el caso persistido. Lo que diga el
    // caller sólo sirve para comprobar que coincide.
    const expectedBinding = caseBinding(
      found.caseId,
      found.entity.clientId,
      found.entity.entityId
    );
    if (input.boundTo !== expectedBinding) return { ok: false, failure: "BINDING_MISMATCH" };

    // 🔴 R4-1: sólo un outcome construido por `buildEvaluationOutcome` y atado a
    // ESTE caso. Un sellador genérico no produce uno aceptable.
    const outcome = readEvaluationOutcome(input.outcome, expectedBinding);
    if (!outcome) return { ok: false, failure: "ARTIFACT_NOT_CANONICAL" };

    if (
      !sameEntity(outcome.entity, found.entity) ||
      outcome.selector.ingressEvidenceId !== found.selector.ingressEvidenceId ||
      outcome.selector.egressEvidenceId !== found.selector.egressEvidenceId
    ) {
      return { ok: false, failure: "OUTCOME_ENTITY_MISMATCH" };
    }
    // Defensa: el estado derivado nunca puede ser terminal.
    if ((TERMINAL_STATES as readonly string[]).includes(outcome.state)) {
      return { ok: false, failure: "STATE_CONFLICT" };
    }

    const next: IntegrityCase = structuredClone({
      ...found,
      version: found.version + 1,
      evaluationLease: null, // la evaluación terminó: se libera el lease
      evidence: outcome.evidence,
      chain: outcome.chain,
      assessment: outcome.assessment,
      state: outcome.state,
      holdReasons: [...outcome.holdReasons],
      updatedAt: input.updatedAt,
    });
    this.cases.set(input.caseId, next);
    return { ok: true, case: freezeCase(next) };
  }

  async applyDecision(input: ApplyDecisionCasInput): Promise<CasResult> {
    if (!isPositiveInt(input.expectedVersion)) return { ok: false, failure: "VERSION_CONFLICT" };
    if (!(TERMINAL_STATES as readonly string[]).includes(input.newState)) {
      return { ok: false, failure: "RECORD_INCOHERENT" };
    }
    const found = this.cases.get(input.caseId);
    if (!found || found.entity.clientId !== input.clientId) {
      return { ok: false, failure: "NOT_FOUND" };
    }

    // HN-1 · §13.7 · LA REGLA VIVE EN EL MODELO, NO EN LA PUERTA. Sólo la
    // unidad física admite decisión humana: la v1 está revocada y 0257 retiró
    // la única RPC capaz de fabricar un caso no físico. Si esta regla quedara
    // sólo en el adaptador de Supabase, cualquier adaptador nuevo reabriría el
    // camino viejo en silencio. Se decide sobre el scope PERSISTIDO del caso,
    // nunca sobre lo que declare el caller.
    if (found.entity.scope !== "physical_unit") {
      return { ok: false, failure: "SCOPE_NOT_DECIDABLE" };
    }

    // R4-1: binding recalculado desde el caso persistido.
    const expectedBinding = caseBinding(
      found.caseId,
      found.entity.clientId,
      found.entity.entityId
    );
    if (!isNonEmptyId(input.boundTo) || input.boundTo !== expectedBinding) {
      return { ok: false, failure: "BINDING_MISMATCH" };
    }
    const proofOrNull = readInspectionProof(input.inspectionProof, expectedBinding);
    if (!proofOrNull) return { ok: false, failure: "ARTIFACT_NOT_CANONICAL" };
    if (found.decision !== null || isTerminal(found.state)) {
      return { ok: false, failure: "ALREADY_DECIDED" };
    }
    if (found.state !== input.expectedState) return { ok: false, failure: "STATE_CONFLICT" };
    if (found.version !== input.expectedVersion) return { ok: false, failure: "VERSION_CONFLICT" };

    const r = input.record;
    if (
      !r ||
      !(DECISION_VALUES as readonly string[]).includes(r.decision) ||
      r.permission !== CUSTODY_DECISION_PERMISSION ||
      r.clientId !== found.entity.clientId ||
      r.previousState !== "REVIEW_REQUIRED" ||
      r.newState !== input.newState ||
      (r.decision === "release") !== (r.newState === "RELEASED") ||
      !isNonEmptyId(r.actorUserId) ||
      !isNonEmptyId(r.actorSessionId) ||
      !isNonEmptyId(r.actorRole) ||
      !isIsoInstant(r.decidedAt) ||
      typeof r.reason !== "string" ||
      r.reason.trim().length < 10
    ) {
      return { ok: false, failure: "RECORD_INCOHERENT" };
    }

    if (r.decision === "release") {
      // La prueba de inspección debe ser válida Y coincidir EXACTAMENTE con lo
      // que el registro dice haber usado. Una lista arbitraria no acredita nada.
      const proof = proofOrNull;
      if (!proof.ok || !isIdList(proof.evidenceIds)) {
        return { ok: false, failure: "INSPECTION_PROOF_INVALID" };
      }
      const declared = [...(r.inspectionEvidenceIds ?? [])].sort();
      const proven = [...proof.evidenceIds].sort();
      if (declared.length !== proven.length || declared.some((v, i) => v !== proven[i])) {
        return { ok: false, failure: "INSPECTION_PROOF_INVALID" };
      }

      // Head: atestación ↔ record ↔ head vigente. Los tres deben coincidir.
      if (!found.chain || found.chain.status !== "verified") {
        return { ok: false, failure: "ATTESTATION_STALE" };
      }
      const attestedHead = found.chain.attestation.chainHead;
      if (
        !isNonEmptyId(input.currentChainHead) ||
        input.currentChainHead !== attestedHead ||
        r.chainHeadAtDecision !== attestedHead ||
        !isAttestationCurrent(found.chain.attestation, input.currentChainHead, r.decidedAt)
      ) {
        return { ok: false, failure: "ATTESTATION_STALE" };
      }

      const eligibility = evaluateReleaseEligibility({
        state: found.state,
        holdReasons: found.holdReasons,
        evidenceOk:
          found.evidence.ingress !== null &&
          found.evidence.egress !== null &&
          !found.holdReasons.some((h) => h.startsWith("EVIDENCE_")),
        chain: found.chain,
        assessment: found.assessment,
        canonicalInspectionEvidenceIds: [...proof.evidenceIds],
        reason: r.reason,
      });
      if (!eligibility.allowed) return { ok: false, failure: "RELEASE_NOT_ELIGIBLE" };
    }

    const next: IntegrityCase = structuredClone({
      ...found,
      version: found.version + 1,
      evaluationLease: null,
      decision: r,
      state: input.newState as IntegrityCaseState,
      updatedAt: input.updatedAt,
    });
    this.cases.set(input.caseId, next);
    return { ok: true, case: freezeCase(next) };
  }
}
