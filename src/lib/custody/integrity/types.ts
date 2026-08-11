/**
 * Validación de Integridad de Custodia — tipos de dominio.
 *
 * REVISIÓN 3 tras el C4 final. El caller no puede expresar identidad, fecha ni
 * procedencia; la cadena sólo es «verificada» si la RPC entrega una atestación
 * completa; y la evidencia de inspección humana **no es representable en el
 * esquema vigente**, por lo que la liberación permanece bloqueada por diseño.
 *
 * Módulo puro: sin IO, sin red, sin Supabase, sin `env`.
 */

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export type IntegrityCaseState =
  | "PENDING_EVIDENCE"
  | "REVIEW_REQUIRED"
  | "RELEASED"
  | "QUARANTINED";

export type DerivableCaseState = "PENDING_EVIDENCE" | "REVIEW_REQUIRED";
export type TerminalCaseState = "RELEASED" | "QUARANTINED";
/** Allowlist de runtime: los tipos no validan un `as any`. */
export const TERMINAL_STATES: readonly IntegrityCaseState[] = ["RELEASED", "QUARANTINED"];

export function isTerminal(state: IntegrityCaseState): state is TerminalCaseState {
  return state === "RELEASED" || state === "QUARANTINED";
}

export type HoldReason =
  | "EVIDENCE_MISSING"
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_ID_MISMATCH"
  | "EVIDENCE_SAME_IMAGE"
  | "EVIDENCE_FOREIGN_ENTITY"
  | "EVIDENCE_FOREIGN_CLIENT"
  | "EVIDENCE_REDACTED"
  | "EVIDENCE_OUT_OF_ORDER"
  | "EVIDENCE_STALE"
  | "EVIDENCE_FUTURE"
  | "EVIDENCE_MALFORMED_DIGEST"
  | "EVIDENCE_MALFORMED_TIMESTAMP"
  | "EVIDENCE_WRONG_STAGE"
  | "CHAIN_INVALID"
  | "CHAIN_UNVERIFIABLE"
  | "CHAIN_EVENTS_NOT_CREDIBLE"
  | "CHAIN_EVIDENCE_NOT_LINKED"
  | "CHAIN_ATTESTATION_STALE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_NOT_EXECUTED"
  | "PROVIDER_THREW"
  | "NON_REAL_EXECUTION"
  | "VERDICT_DIFFERENCES"
  | "VERDICT_POSSIBLE_DAMAGE"
  | "NO_CALIBRATED_THRESHOLD";

/** Única retención compatible con una liberación. Ver `release-policy.ts`. */
export const RELEASABLE_HOLD_SET: readonly HoldReason[] = ["NO_CALIBRATED_THRESHOLD"];

// ---------------------------------------------------------------------------
// Identidad
// ---------------------------------------------------------------------------

export type CustodyEntityScope = "packing_unit" | "shipment";

export interface CustodyEntityRef {
  scope: CustodyEntityScope;
  entityId: string;
  clientId: string;
}

export function sameEntity(a: CustodyEntityRef, b: CustodyEntityRef): boolean {
  return a.scope === b.scope && a.entityId === b.entityId && a.clientId === b.clientId;
}

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------

export type CustodyStage = "packing" | "despacho" | "transporte" | "entrega" | "pod";
export type CustodyEventType =
  | "foto_packing"
  | "cargado"
  | "en_transito"
  | "foto_entrega"
  | "firmado"
  | "pod"
  /**
   * D1 · Tipo canónico de la inspección física humana. Lo agregó 0221 al enum
   * `custody_event_type_t` y 0226 lo atesta; el dominio lo reconoce ahora por
   * decisión expresa de Dirección. Es el ÚNICO tipo nuevo autorizado.
   */
  | "inspeccion_humana";

/** Soporte de la evidencia. D1 exige `foto` para la inspección humana. */
export type CustodyEvidenceKind = "foto" | "firma" | "documento";

/**
 * Pares (stage, eventType) admisibles en cada extremo.
 *
 * Se valida el PAR, no sólo el `eventType`: un `foto_entrega` declarado con
 * `stage: "packing"` es incoherente con el CHECK
 * `custody_events_stage_type_chk` de 0036 y debe rechazarse.
 */
export const INGRESS_PAIRS: ReadonlyArray<readonly [CustodyStage, CustodyEventType]> = [
  ["packing", "foto_packing"],
];
export const EGRESS_PAIRS: ReadonlyArray<readonly [CustodyStage, CustodyEventType]> = [
  ["entrega", "foto_entrega"],
];

/**
 * D1 · EVIDENCIA DE INSPECCIÓN HUMANA — decisión de Dirección aplicada.
 *
 * Antes esta lista estaba VACÍA porque el enum de 0036 no podía representar una
 * inspección física humana, y en consecuencia la liberación quedaba bloqueada
 * por diseño. El soporte ya está materializado en la DB —0221 agrega
 * `inspeccion_humana` al enum, 0222 lo admite en
 * `custody_events_stage_type_chk` y 0226 exige atestación server-side del
 * contenido para ese par— y Dirección autorizó reconocerlo.
 *
 * Se admite EXACTAMENTE UN par. No se agrega semántica adicional: cualquier
 * otra combinación sigue siendo `INSPECTION_NOT_REPRESENTABLE_IN_SCHEMA`.
 *
 * Lo que esto NO cambia: la liberación sigue exigiendo actor humano autorizado,
 * motivo, cadena verificada y evaluación real. `NO_AUTOMATIC_RELEASE` intacto.
 */
export const INSPECTION_PAIRS: ReadonlyArray<readonly [CustodyStage, CustodyEventType]> = [
  ["despacho", "inspeccion_humana"],
];

/** D1 · La inspección humana se acredita con FOTO; ningún otro soporte vale. */
export const INSPECTION_EVIDENCE_KIND: CustodyEvidenceKind = "foto";

export interface EvidenceRecord {
  evidenceId: string;
  eventId: string;
  scope: CustodyEntityScope;
  entityId: string;
  clientId: string;
  stage: CustodyStage;
  eventType: CustodyEventType;
  /**
   * Soporte de la evidencia. Opcional en el tipo porque el par comparado
   * (ingreso/egreso) no lo necesita, pero la inspección humana lo EXIGE: un
   * registro sin `kind` no puede acreditar una inspección.
   */
  kind?: CustodyEvidenceKind | null;
  sha256: string;
  capturedAt: string;
  redacted: boolean;
}

export interface EvidencePairSelector {
  ingressEvidenceId: string | null;
  egressEvidenceId: string | null;
}

export interface EvidenceValidation {
  ok: boolean;
  problems: HoldReason[];
  eventIds: string[];
}

export type InspectionEvidenceProblem =
  | "INSPECTION_NOT_REPRESENTABLE_IN_SCHEMA"
  /** D1 · el soporte no es `foto` (o no vino informado). */
  | "INSPECTION_WRONG_KIND"
  | "INSPECTION_ID_MISMATCH"
  | "INSPECTION_FOREIGN_CLIENT"
  | "INSPECTION_FOREIGN_ENTITY"
  | "INSPECTION_REDACTED"
  | "INSPECTION_DUPLICATED"
  | "INSPECTION_SAME_AS_COMPARED";

export interface InspectionEvidenceValidation {
  ok: boolean;
  problems: InspectionEvidenceProblem[];
  evidenceIds: string[];
}

// ---------------------------------------------------------------------------
// Cadena
// ---------------------------------------------------------------------------

/**
 * Atestación producida POR LA VERIFICACIÓN, no por el caller.
 *
 * `attestedAt` y `chainHead` los emite la RPC. Etiquetar una cadena como
 * verificada usando la hora que aportó el caso de uso no acredita nada.
 */
export interface ChainAttestation {
  scope: CustodyEntityScope;
  entityId: string;
  chainHead: string;
  eventsChecked: number;
  verifiedEventIds: readonly string[];
  attestedAt: string;
}

export type ChainVerification =
  | { status: "verified"; attestation: ChainAttestation }
  | {
      status: "invalid";
      eventsChecked: number;
      verifiedAt: string;
      firstError: { publicId?: string; chainSeq?: number; reason?: string } | null;
    }
  | { status: "unverifiable"; verifiedAt: string; error: string };

// ---------------------------------------------------------------------------
// Evaluación asistida por IA
// ---------------------------------------------------------------------------

export type IntegrityVerdictKind = "coincide" | "diferencias" | "posible_dano";
export const VERDICT_VALUES: readonly IntegrityVerdictKind[] = [
  "coincide",
  "diferencias",
  "posible_dano",
];

export type ProviderOutcomeKind =
  | "ok"
  | "timeout"
  | "unavailable"
  | "invalid_response"
  | "threw"
  | "not_executed";
export const OUTCOME_VALUES: readonly ProviderOutcomeKind[] = [
  "ok",
  "timeout",
  "unavailable",
  "invalid_response",
  "threw",
  "not_executed",
];

export type ExecutionMode = "real" | "mock" | "cached";
export const EXECUTION_MODES: readonly ExecutionMode[] = ["real", "mock", "cached"];

export interface ProviderProvenance {
  provider: string;
  model: string;
  promptVersion: string;
  /** Resuelto contra una allowlist server-side, NO por el adaptador. */
  executionMode: ExecutionMode;
  requestedAt: string;
  completedAt: string | null;
}

export interface IntegrityAssessment {
  outcome: ProviderOutcomeKind;
  verdict: IntegrityVerdictKind | null;
  /** Autoconfianza del modelo, 0..1. No es similitud ni probabilidad de daño. */
  modelConfidence: number | null;
  observations: string[];
  zones: string[];
  provenance: ProviderProvenance;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Actor verificado y comando
// ---------------------------------------------------------------------------

export const CUSTODY_DECISION_PERMISSION = "wms.custody.decide";

/** Producido EXCLUSIVAMENTE por el puerto de autorización server-side. */
export interface VerifiedActor {
  readonly subjectType: "human_session";
  userId: string;
  sessionId: string;
  clientId: string;
  role: string;
  permissions: readonly string[];
}

export const DECISION_VALUES = ["release", "quarantine"] as const;
export type HumanDecisionKind = (typeof DECISION_VALUES)[number];

/** Único payload que el exterior puede enviar. Sin identidad, sin fecha. */
export interface DecisionCommand {
  decision: HumanDecisionKind;
  reason: string;
  observations?: string | null;
  inspectionEvidenceIds: string[];
}

export interface HumanDecisionRecord {
  decision: HumanDecisionKind;
  actorUserId: string;
  actorSessionId: string;
  actorRole: string;
  clientId: string;
  permission: string;
  decidedAt: string;
  reason: string;
  observations: string | null;
  inspectionEvidenceIds: string[];
  previousState: IntegrityCaseState;
  newState: TerminalCaseState;
  /** Head de cadena vigente al decidir. Ata la decisión a la atestación. */
  chainHeadAtDecision: string | null;
}

// ---------------------------------------------------------------------------
// Caso
// ---------------------------------------------------------------------------

/** Lease de evaluación: evita el doble egress y permite reclaim tras un fallo. */
export interface EvaluationLease {
  holder: string;
  until: string;
}

export interface IntegrityCase {
  caseId: string;
  version: number;
  /** No nulo mientras alguien tiene la evaluación reservada. */
  evaluationLease: EvaluationLease | null;
  entity: CustodyEntityRef;
  selector: EvidencePairSelector;
  state: IntegrityCaseState;
  holdReasons: HoldReason[];
  evidence: { ingress: EvidenceRecord | null; egress: EvidenceRecord | null };
  chain: ChainVerification | null;
  assessment: IntegrityAssessment | null;
  decision: HumanDecisionRecord | null;
  createdAt: string;
  updatedAt: string;
}

/** Copia profunda e inmutable. Impide mutar el caso persistido por alias. */
export function freezeCase(c: IntegrityCase): IntegrityCase {
  return Object.freeze(structuredClone(c));
}
