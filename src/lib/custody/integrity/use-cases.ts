/**
 * Casos de uso. Toda dependencia entra por inyección.
 *
 * REVISIÓN 3. Cierra F-4: la **reserva atómica** del caso ocurre ANTES de
 * cualquier egress hacia el proveedor. Dos evaluaciones iniciales concurrentes
 * ya no invocan dos veces al proveedor ni terminan en una excepción sin tipar:
 * una gana y la otra recibe un conflicto tipado.
 *
 * Y la decisión revalida la cadena: la atestación debe seguir describiendo el
 * head vigente al liberar.
 */

import { buildEvaluationOutcome, buildInspectionProof } from "./canonical";
import { type VerifyChainPort } from "./chain";
import { applyHumanDecision, type DecisionRejection } from "./human-decision";
import type {
  ActorAuthorizationPort,
  CasFailure,
  ChainHeadPort,
  EvidenceLoaderPort,
  IntegrityCaseRepository,
} from "./ports";
import type { IntegrityVisionProvider } from "./provider";
import { EMPTY_PROVIDER_REGISTRY, type ProviderRegistry } from "./provider-registry";
import { caseBinding } from "./sealed";
import type { ReleaseBlocker } from "./release-policy";
import {
  isTerminal,
  sameEntity,
  type CustodyEntityRef,
  type DecisionCommand,
  type EvidencePairSelector,
  type EvidenceRecord,
  type IntegrityCase,
} from "./types";
import { isNonEmptyId } from "./validation";

const DEFAULT_LEASE_MINUTES = 5;

export interface EvaluateDeps {
  repository: IntegrityCaseRepository;
  evidenceLoader: EvidenceLoaderPort;
  provider: IntegrityVisionProvider;
  verifyChain: VerifyChainPort;
  now: () => string;
  /** Registro de identidad de proveedores. Vacío ⇒ nada es real. */
  providerRegistry?: ProviderRegistry;
  egressMaxAgeMinutes?: number;
  /** Duración del lease de evaluación, en minutos. */
  leaseMinutes?: number;
}

export interface EvaluateInput {
  caseId: string;
  entity: CustodyEntityRef;
  selector: EvidencePairSelector;
  requesterClientId: string;
}

export type EvaluateError =
  | "CLIENT_MISMATCH"
  | "CASE_IDENTITY_MISMATCH"
  | "EVIDENCE_MISMATCH"
  | "CASE_ALREADY_DECIDED"
  | "CASE_ALREADY_EVALUATED"
  | "EVALUATION_IN_PROGRESS"
  | `RESERVE_${CasFailure}`
  | `PERSIST_${CasFailure}`;

export type EvaluateResult =
  | { ok: true; case: IntegrityCase }
  | { ok: false; error: EvaluateError };

function sameSelector(a: EvidencePairSelector, b: EvidencePairSelector): boolean {
  return a.ingressEvidenceId === b.ingressEvidenceId && a.egressEvidenceId === b.egressEvidenceId;
}

export async function evaluateIntegrityCase(
  deps: EvaluateDeps,
  input: EvaluateInput
): Promise<EvaluateResult> {
  if (input.entity.clientId !== input.requesterClientId) {
    return { ok: false, error: "CLIENT_MISMATCH" };
  }

  const evaluatedAt = deps.now();
  const registry = deps.providerRegistry ?? EMPTY_PROVIDER_REGISTRY;
  const bound = caseBinding(input.caseId, input.entity.clientId, input.entity.entityId);
  const leaseUntil = new Date(
    Date.parse(evaluatedAt) + (deps.leaseMinutes ?? DEFAULT_LEASE_MINUTES) * 60_000
  ).toISOString();

  // ── F-4/R3-4: RESERVA CON LEASE antes de cualquier egress ──────────────
  const reserved = await deps.repository.reserveCase({
    caseId: input.caseId,
    entity: input.entity,
    selector: input.selector,
    createdAt: evaluatedAt,
    holder: `${input.caseId}@${evaluatedAt}`,
    leaseUntil,
  });
  if (!reserved.ok) return { ok: false, error: `RESERVE_${reserved.failure}` };

  const current = reserved.case;

  if (isTerminal(current.state)) return { ok: false, error: "CASE_ALREADY_DECIDED" };
  if (!sameEntity(current.entity, input.entity)) {
    return { ok: false, error: "CASE_IDENTITY_MISMATCH" };
  }
  if (!sameSelector(current.selector, input.selector)) {
    return { ok: false, error: "EVIDENCE_MISMATCH" };
  }
  // 🔴 SÓLO EL CREADOR EVALÚA. La reserva es la claim: quien no creó el caso no
  // llega al proveedor. Sin esto, dos callers concurrentes leían `assessment ===
  // null` a la vez y ambos disparaban el egress de fotos.
  if (!reserved.claimed) {
    return {
      ok: false,
      error: current.assessment !== null ? "CASE_ALREADY_EVALUATED" : "EVALUATION_IN_PROGRESS",
    };
  }

  // ── Carga canónica de evidencia ────────────────────────────────────────
  let pair: { ingress: EvidenceRecord | null; egress: EvidenceRecord | null } = {
    ingress: null,
    egress: null,
  };
  let loaderError: string | null = null;
  if (
    isNonEmptyId(input.selector.ingressEvidenceId) &&
    isNonEmptyId(input.selector.egressEvidenceId)
  ) {
    try {
      pair = await deps.evidenceLoader.loadPair({
        clientId: input.requesterClientId,
        scope: input.entity.scope,
        entityId: input.entity.entityId,
        selector: input.selector,
      });
    } catch (e) {
      // R3-4: la excepción se vuelve resultado tipado y estado fail-closed;
      // el lease se libera al persistir, así el caso es recuperable.
      loaderError = e instanceof Error ? e.message : String(e);
      pair = { ingress: null, egress: null };
    }
  }

  // El proveedor se invoca sólo con evidencia estructuralmente utilizable; el
  // resto de la validación (y la derivación de estado) la hace el constructor
  // canónico, que es el único camino a un `EvaluationOutcome`.
  // 🔴 R6: el caso de uso NO invoca al proveedor. El flujo canónico posee la
  // invocación, para que el proveedor compare exactamente el mismo snapshot
  // que después se valida, deriva y persiste.
  const outcome = await buildEvaluationOutcome({
    caseId: input.caseId,
    entity: input.entity,
    selector: input.selector,
    pair,
    provider: deps.provider,
    registry,
    verifyChain: deps.verifyChain,
    evaluatedAt,
    egressMaxAgeMinutes: deps.egressMaxAgeMinutes,
    now: deps.now,
    loaderError,
  });

  const persisted = await deps.repository.recordAssessment({
    caseId: current.caseId,
    clientId: input.requesterClientId,
    expectedVersion: current.version,
    updatedAt: evaluatedAt,
    outcome,
    boundTo: bound,
  });

  if (!persisted.ok) return { ok: false, error: `PERSIST_${persisted.failure}` };
  return { ok: true, case: persisted.case };
}

// ---------------------------------------------------------------------------
// Decisión
// ---------------------------------------------------------------------------

export interface DecideDeps {
  repository: IntegrityCaseRepository;
  authorization: ActorAuthorizationPort;
  evidenceLoader: EvidenceLoaderPort;
  chainHead: ChainHeadPort;
  now: () => string;
}

export type DecideError = DecisionRejection | "CASE_NOT_FOUND" | `PERSIST_${CasFailure}`;

export type DecideResult =
  | { ok: true; case: IntegrityCase }
  | { ok: false; error: DecideError; blockers?: ReleaseBlocker[] };

export async function decideIntegrityCase(
  deps: DecideDeps,
  caseId: string,
  command: DecisionCommand
): Promise<DecideResult> {
  const actor = await deps.authorization.resolveActor();
  if (!actor) return { ok: false, error: "ACTOR_NOT_VERIFIED" };

  const found = await deps.repository.findById(caseId, actor.clientId);
  if (!found) return { ok: false, error: "CASE_NOT_FOUND" };

  const comparedIds = [
    found.evidence.ingress?.evidenceId,
    found.evidence.egress?.evidenceId,
  ].filter(isNonEmptyId);

  // Evidencia de inspección: cargada y REVALIDADA contra el caso.
  const requested = Array.isArray(command?.inspectionEvidenceIds)
    ? command.inspectionEvidenceIds
    : [];
  const loaded =
    requested.length > 0
      ? await deps.evidenceLoader.loadInspectionEvidence({
          clientId: actor.clientId,
          scope: found.entity.scope,
          entityId: found.entity.entityId,
          evidenceIds: requested,
        })
      : [];
  const bound = caseBinding(caseId, found.entity.clientId, found.entity.entityId);
  const inspection = buildInspectionProof(caseId, found.entity, requested, loaded, comparedIds);

  // Head vigente: ata la decisión a la atestación de la evaluación.
  const currentHead = await deps.chainHead.currentChainHead(
    found.entity.scope,
    found.entity.entityId
  );

  const outcome = applyHumanDecision({
    currentState: found.state,
    caseClientId: found.entity.clientId,
    actor,
    command,
    nowIso: deps.now(),
    currentChainHead: currentHead,
    releaseContext: {
      holdReasons: found.holdReasons,
      evidenceOk:
        found.evidence.ingress !== null &&
        found.evidence.egress !== null &&
        !found.holdReasons.some((r) => r.startsWith("EVIDENCE_")),
      chain: found.chain,
      assessment: found.assessment,
      canonicalInspectionEvidenceIds: inspection.ok ? [...inspection.evidenceIds] : [],
    },
  });

  if (!outcome.ok) return { ok: false, error: outcome.rejection, blockers: outcome.blockers };

  const persisted = await deps.repository.applyDecision({
    caseId,
    clientId: actor.clientId,
    expectedVersion: found.version,
    expectedState: "REVIEW_REQUIRED",
    record: outcome.record,
    newState: outcome.state,
    updatedAt: deps.now(),
    currentChainHead: currentHead,
    inspectionProof: inspection,
    boundTo: bound,
  });

  if (!persisted.ok) return { ok: false, error: `PERSIST_${persisted.failure}` };
  return { ok: true, case: persisted.case };
}
