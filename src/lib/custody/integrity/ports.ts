/**
 * Puertos. Sólo contratos: ninguna implementación vive acá.
 *
 * REVISIÓN 3. Añade `reserveCase`, la reserva atómica que cierra F-4: dos
 * evaluaciones concurrentes ya no pueden llamar dos veces al proveedor ni
 * terminar en una excepción de caso duplicado.
 */

import type { EvaluationOutcome, InspectionProof } from "./canonical";
import type {
  CustodyEntityRef,
  EvidencePairSelector,
  EvidenceRecord,
  HumanDecisionRecord,
  IntegrityCase,
  TerminalCaseState,
  VerifiedActor,
} from "./types";

// ---------------------------------------------------------------------------
// Autorización
// ---------------------------------------------------------------------------

/**
 * Frontera server-side de sesión/RBAC. ÚNICA fuente de identidad.
 * ⚠️ El adaptador real no existe: por eso A-1 se reporta PARCIAL.
 */
export interface ActorAuthorizationPort {
  resolveActor(): Promise<VerifiedActor | null>;
}

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------

export interface LoadEvidencePairInput {
  clientId: string;
  scope: CustodyEntityRef["scope"];
  entityId: string;
  selector: EvidencePairSelector;
}

export interface EvidenceLoaderPort {
  loadPair(input: LoadEvidencePairInput): Promise<{
    ingress: EvidenceRecord | null;
    egress: EvidenceRecord | null;
  }>;
  loadInspectionEvidence(input: {
    clientId: string;
    scope: CustodyEntityRef["scope"];
    entityId: string;
    evidenceIds: readonly string[];
  }): Promise<EvidenceRecord[]>;
}

/** Head vigente de la cadena de una entidad, para revalidar la atestación. */
export interface ChainHeadPort {
  currentChainHead(scope: CustodyEntityRef["scope"], entityId: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

export interface ReserveCaseInput {
  caseId: string;
  entity: CustodyEntityRef;
  selector: EvidencePairSelector;
  createdAt: string;
  /** Identidad del intento; queda en el lease para diagnóstico. */
  holder: string;
  /** Vencimiento del lease. Tras él, otro intento puede reclamarlo. */
  leaseUntil: string;
}

export interface RecordAssessmentInput {
  caseId: string;
  clientId: string;
  expectedVersion: number;
  updatedAt: string;
  /**
   * Resultado CANÓNICO. Trae los hechos ya revalidados y el estado/holds
   * DERIVADOS por `buildEvaluationOutcome`. El caller no aporta ninguno de
   * esos valores: no hay campo por donde hacerlo.
   */
  outcome: EvaluationOutcome;
  /** Se compara contra el binding recalculado desde el caso persistido. */
  boundTo: string;
}

export interface ApplyDecisionCasInput {
  caseId: string;
  clientId: string;
  expectedVersion: number;
  expectedState: "REVIEW_REQUIRED";
  record: HumanDecisionRecord;
  newState: TerminalCaseState;
  updatedAt: string;
  /** Head vigente al decidir. Debe coincidir con la atestación Y con el record. */
  currentChainHead: string | null;
  /**
   * Prueba de inspección SELLADA por el dominio y atada a este caso.
   * Sin ella no hay liberación posible: una lista de IDs no acredita nada.
   */
  inspectionProof: InspectionProof;
  /** Contexto (`caseBinding`) contra el que se verifica el sello. */
  boundTo: string;
}

export type CasFailure =
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "ALREADY_DECIDED"
  | "STATE_CONFLICT"
  | "RECORD_INCOHERENT"
  | "RELEASE_NOT_ELIGIBLE"
  | "ATTESTATION_STALE"
  | "ARTIFACT_NOT_SEALED"
  | "ARTIFACT_NOT_CANONICAL"
  | "BINDING_MISMATCH"
  | "OUTCOME_ENTITY_MISMATCH"
  | "INSPECTION_PROOF_INVALID"
  | "LEASE_HELD";

export type CasResult =
  | { ok: true; case: IntegrityCase }
  | { ok: false; failure: CasFailure };

export type ReserveResult =
  | { ok: true; case: IntegrityCase; claimed: boolean }
  | { ok: false; failure: CasFailure };

export interface IntegrityCaseRepository {
  /** Get-or-create ATÓMICO. Serializa la primera evaluación. */
  reserveCase(input: ReserveCaseInput): Promise<ReserveResult>;
  findById(caseId: string, clientId: string): Promise<IntegrityCase | null>;
  recordAssessment(input: RecordAssessmentInput): Promise<CasResult>;
  applyDecision(input: ApplyDecisionCasInput): Promise<CasResult>;
}
