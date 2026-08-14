/**
 * Máquina de estados derivada. Módulo puro.
 *
 * REGLA CENTRAL: la derivación automática sólo produce `PENDING_EVIDENCE` o
 * `REVIEW_REQUIRED` — el tipo de retorno es `DerivableCaseState`, así que un
 * estado terminal ni siquiera es expresable acá. `RELEASED`/`QUARANTINED` sólo
 * existen a través de `applyHumanDecision`.
 *
 * Ni un caso impecable libera solo: no hay umbral calibrado. La auditoría del
 * 2026-08-09 estableció que el «90 %» nunca existió como regla y que el número
 * mostrado era la autoconfianza del modelo relabelada.
 */

import type {
  ChainVerification,
  DerivableCaseState,
  EvidenceValidation,
  HoldReason,
  IntegrityAssessment,
  IntegrityCaseState,
} from "./types";

export interface DeriveInput {
  evidence: EvidenceValidation;
  chain: ChainVerification;
  assessment: IntegrityAssessment;
}

export interface DeriveResult {
  state: DerivableCaseState;
  reasons: HoldReason[];
}

function chainReasons(chain: ChainVerification): HoldReason[] {
  switch (chain.status) {
    case "verified":
      // La atestación ya exige entero positivo; se revalida por si el objeto
      // fue construido fuera de `verifyChainForCase`.
      return Number.isInteger(chain.attestation.eventsChecked) && chain.attestation.eventsChecked > 0
        ? []
        : ["CHAIN_EVENTS_NOT_CREDIBLE"];
    case "invalid":
      return ["CHAIN_INVALID"];
    case "unverifiable":
      return ["CHAIN_UNVERIFIABLE"];
  }
}

function providerReasons(assessment: IntegrityAssessment): HoldReason[] {
  const reasons: HoldReason[] = [];

  switch (assessment.outcome) {
    case "timeout":
      reasons.push("PROVIDER_TIMEOUT");
      break;
    case "unavailable":
      reasons.push("PROVIDER_UNAVAILABLE");
      break;
    case "invalid_response":
      reasons.push("PROVIDER_INVALID_RESPONSE");
      break;
    case "threw":
      reasons.push("PROVIDER_THREW");
      break;
    case "not_executed":
      reasons.push("PROVIDER_NOT_EXECUTED");
      break;
    case "ok":
      break;
  }

  if (assessment.provenance.executionMode !== "real") reasons.push("NON_REAL_EXECUTION");

  if (assessment.outcome === "ok") {
    if (assessment.verdict === "diferencias") reasons.push("VERDICT_DIFFERENCES");
    if (assessment.verdict === "posible_dano") reasons.push("VERDICT_POSSIBLE_DAMAGE");
    if (assessment.verdict === null) reasons.push("PROVIDER_INVALID_RESPONSE");
  }

  return reasons;
}

export function deriveIntegrityCaseState(input: DeriveInput): DeriveResult {
  if (!input.evidence.ok && input.evidence.problems.includes("EVIDENCE_MISSING")) {
    return { state: "PENDING_EVIDENCE", reasons: input.evidence.problems };
  }

  const reasons: HoldReason[] = [
    ...input.evidence.problems,
    ...chainReasons(input.chain),
    ...providerReasons(input.assessment),
  ];

  if (reasons.length === 0) {
    // Técnicamente impecable y aun así retenido: sin umbral calibrado no hay
    // liberación automática legítima.
    return { state: "REVIEW_REQUIRED", reasons: ["NO_CALIBRATED_THRESHOLD"] };
  }

  return { state: "REVIEW_REQUIRED", reasons };
}

/**
 * Predicado único de retención operativa. `RELEASED` es el ÚNICO estado que no
 * retiene, y sólo se alcanza por decisión humana registrada.
 */
export function holdsOperations(state: IntegrityCaseState): boolean {
  return state !== "RELEASED";
}

export const HELD_OPERATIONS = ["reserve", "picking", "packing", "loading", "dispatch"] as const;
export type HeldOperation = (typeof HELD_OPERATIONS)[number];

export function canPerform(operation: HeldOperation, state: IntegrityCaseState): boolean {
  void operation; // el hold es uniforme: ninguna etapa tiene excepción
  return !holdsOperations(state);
}
