/**
 * Decisión humana. Módulo puro.
 *
 * REVISIÓN 3. El comando se valida en RUNTIME antes de cualquier otra cosa: una
 * `decision` desconocida no se degrada en silencio a `quarantine`, un `reason`
 * que no sea string se rechaza, y `inspectionEvidenceIds` debe ser una lista de
 * identificadores reales sin duplicados.
 *
 * La identidad sigue viniendo sólo de `VerifiedActor` y la fecha sólo del reloj
 * del servidor: el comando no tiene forma de expresarlas.
 */

import { evaluateReleaseEligibility, type ReleaseBlocker } from "./release-policy";
import type { ReleaseEligibilityContext } from "./release-policy";
import {
  CUSTODY_DECISION_PERMISSION,
  DECISION_VALUES,
  type DecisionCommand,
  type HumanDecisionRecord,
  type IntegrityCaseState,
  type TerminalCaseState,
  type VerifiedActor,
} from "./types";
import { isIsoInstant, isNonEmptyId } from "./validation";

export type DecisionRejection =
  | "ACTOR_NOT_VERIFIED"
  | "PERMISSION_DENIED"
  | "CLIENT_MISMATCH"
  | "COMMAND_INVALID"
  | "REASON_MISSING"
  | "STATE_NOT_DECIDABLE"
  | "ALREADY_DECIDED"
  | "RELEASE_NOT_ELIGIBLE"
  | "CLOCK_INVALID";

export type DecisionResult =
  | { ok: true; state: TerminalCaseState; record: HumanDecisionRecord }
  | { ok: false; rejection: DecisionRejection; blockers?: ReleaseBlocker[] };

export type CommandProblem =
  | "DECISION_UNKNOWN"
  | "REASON_NOT_STRING"
  | "REASON_TOO_SHORT"
  | "INSPECTION_IDS_NOT_ARRAY"
  | "INSPECTION_IDS_MALFORMED"
  | "OBSERVATIONS_NOT_STRING";

/** Validación de forma del comando externo. Nada se degrada en silencio. */
export function validateDecisionCommand(command: unknown): {
  ok: boolean;
  problems: CommandProblem[];
} {
  const problems: CommandProblem[] = [];
  const c = command as Partial<DecisionCommand> | null | undefined;

  if (!c || !(DECISION_VALUES as readonly unknown[]).includes(c.decision)) {
    problems.push("DECISION_UNKNOWN");
  }
  if (typeof c?.reason !== "string") {
    problems.push("REASON_NOT_STRING");
  } else if (c.reason.trim().length < 10) {
    problems.push("REASON_TOO_SHORT");
  }
  if (!Array.isArray(c?.inspectionEvidenceIds)) {
    problems.push("INSPECTION_IDS_NOT_ARRAY");
  } else {
    const ids = c.inspectionEvidenceIds;
    const allValid = ids.every(isNonEmptyId);
    const unique = new Set(ids.map((v) => String(v).trim())).size === ids.length;
    if (!allValid || !unique) problems.push("INSPECTION_IDS_MALFORMED");
  }
  if (c?.observations !== undefined && c?.observations !== null && typeof c.observations !== "string") {
    problems.push("OBSERVATIONS_NOT_STRING");
  }

  return { ok: problems.length === 0, problems };
}

export function actorMayDecide(actor: VerifiedActor | null): boolean {
  return (
    actor !== null &&
    actor.subjectType === "human_session" &&
    isNonEmptyId(actor.userId) &&
    isNonEmptyId(actor.sessionId) &&
    isNonEmptyId(actor.clientId) &&
    isNonEmptyId(actor.role) &&
    Array.isArray(actor.permissions) &&
    actor.permissions.includes(CUSTODY_DECISION_PERMISSION)
  );
}

export interface ApplyDecisionInput {
  currentState: IntegrityCaseState;
  caseClientId: string;
  actor: VerifiedActor | null;
  command: DecisionCommand;
  nowIso: string;
  /** Head de cadena vigente, para atar la decisión a la atestación. */
  currentChainHead: string | null;
  releaseContext: Omit<ReleaseEligibilityContext, "state" | "reason">;
}

export function applyHumanDecision(input: ApplyDecisionInput): DecisionResult {
  const { currentState, caseClientId, actor, command, nowIso } = input;

  if (!actorMayDecide(actor)) {
    if (actor && actor.subjectType === "human_session" && isNonEmptyId(actor.userId)) {
      return { ok: false, rejection: "PERMISSION_DENIED" };
    }
    return { ok: false, rejection: "ACTOR_NOT_VERIFIED" };
  }
  const verified = actor as VerifiedActor;

  const shape = validateDecisionCommand(command);
  if (!shape.ok) {
    return {
      ok: false,
      rejection: shape.problems.includes("REASON_TOO_SHORT") ? "REASON_MISSING" : "COMMAND_INVALID",
    };
  }

  if (verified.clientId !== caseClientId) return { ok: false, rejection: "CLIENT_MISMATCH" };
  if (!isIsoInstant(nowIso)) return { ok: false, rejection: "CLOCK_INVALID" };

  if (currentState === "RELEASED" || currentState === "QUARANTINED") {
    return { ok: false, rejection: "ALREADY_DECIDED" };
  }
  if (currentState !== "REVIEW_REQUIRED" && currentState !== "HOLD") {
    return { ok: false, rejection: "STATE_NOT_DECIDABLE" };
  }

  const reason = command.reason.trim();

  if (command.decision === "release") {
    const eligibility = evaluateReleaseEligibility({
      ...input.releaseContext,
      state: currentState,
      reason,
    });
    if (!eligibility.allowed) {
      return { ok: false, rejection: "RELEASE_NOT_ELIGIBLE", blockers: eligibility.blockers };
    }
  }

  const newState: TerminalCaseState = command.decision === "release" ? "RELEASED" : "QUARANTINED";

  return {
    ok: true,
    state: newState,
    record: {
      decision: command.decision,
      actorUserId: verified.userId,
      actorSessionId: verified.sessionId,
      actorRole: verified.role,
      clientId: verified.clientId,
      permission: CUSTODY_DECISION_PERMISSION,
      decidedAt: nowIso,
      reason,
      observations: command.observations?.trim() || null,
      inspectionEvidenceIds: [...input.releaseContext.canonicalInspectionEvidenceIds],
      previousState: currentState,
      newState,
      chainHeadAtDecision: input.currentChainHead,
    },
  };
}
