/**
 * Constructores CANÓNICOS. R4-1 + R5.
 *
 * R5 cierra el defecto que el C4 reprodujo: `Object.freeze` es superficial, y
 * el registro guardaba sólo el binding, así que `readEvaluationOutcome` devolvía
 * el objeto del caller. Se podía derivar `state`/`holdReasons` con evidencia
 * válida y luego marcar `outcome.evidence.ingress.redacted = true`.
 *
 * Ahora:
 *  · se toman **snapshots profundos de todos los inputs ANTES de cualquier
 *    `await`**, y toda la validación, derivación y persistencia usa ese mismo
 *    snapshot;
 *  · el `WeakMap` privado guarda `{ binding, snapshot }` — el snapshot es la
 *    AUTORIDAD, no el handle;
 *  · `readEvaluationOutcome` devuelve el snapshot privado, nunca los campos del
 *    objeto que el caller vuelve a presentar;
 *  · la `IntegrityAssessment` se construye **dentro** de este flujo a partir del
 *    payload crudo: no se acepta una assessment libre aportada desde afuera.
 *
 * Sigue siendo defensa en profundidad dentro del proceso; la frontera
 * productiva será la RPC transaccional.
 */

import { verifyChainForCase, type VerifyChainPort, type VerifyChainRequest } from "./chain";
import { deriveIntegrityCaseState } from "./decision";
import { EGRESS_MAX_AGE_MINUTES, validateEvidencePair, validateInspectionEvidence } from "./evidence";
import {
  buildAssessmentFromIdentity,
  captureProviderIdentity,
  type IntegrityVisionProvider,
  type RawProviderPayload,
} from "./provider";
import type { ProviderRegistry } from "./provider-registry";
import { caseBinding } from "./sealed";
import {
  snapshotAssessment,
  snapshotChain,
  snapshotEntity,
  snapshotHoldReasons,
  snapshotIds,
  snapshotPair,
  snapshotSelector,
} from "./snapshot";
import type {
  ChainVerification,
  CustodyEntityRef,
  DerivableCaseState,
  EvidencePairSelector,
  EvidenceRecord,
  HoldReason,
  IntegrityAssessment,
} from "./types";
import { isNonEmptyId } from "./validation";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface EvaluationOutcome {
  readonly entity: CustodyEntityRef;
  readonly selector: EvidencePairSelector;
  readonly evidence: { ingress: EvidenceRecord | null; egress: EvidenceRecord | null };
  readonly chain: ChainVerification;
  readonly assessment: IntegrityAssessment;
  readonly state: DerivableCaseState;
  readonly holdReasons: readonly HoldReason[];
  readonly evaluatedAt: string;
}

export interface InspectionProof {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly evidenceIds: readonly string[];
}

/**
 * Registros PRIVADOS. Guardan el SNAPSHOT autoritativo, no sólo el binding:
 * el handle público es una copia, la autoridad vive acá.
 */
const OUTCOMES = new WeakMap<object, { binding: string; snapshot: EvaluationOutcome }>();
const PROOFS = new WeakMap<object, { binding: string; snapshot: InspectionProof }>();

/** Construye el par handle/snapshot a partir de las partes ya congeladas. */
function materializeOutcome(parts: EvaluationOutcome): EvaluationOutcome {
  return Object.freeze({
    entity: parts.entity,
    selector: parts.selector,
    evidence: parts.evidence,
    chain: parts.chain,
    assessment: parts.assessment,
    state: parts.state,
    holdReasons: parts.holdReasons,
    evaluatedAt: parts.evaluatedAt,
  });
}

// ---------------------------------------------------------------------------
// Constructor canónico de outcome
// ---------------------------------------------------------------------------

export interface BuildOutcomeInput {
  caseId: string;
  entity: CustodyEntityRef;
  selector: EvidencePairSelector;
  pair: { ingress: EvidenceRecord | null; egress: EvidenceRecord | null };
  /** Instancia concreta. Se captura por referencia antes del primer await. */
  provider: IntegrityVisionProvider;
  registry: ProviderRegistry;
  verifyChain: VerifyChainPort;
  evaluatedAt: string;
  egressMaxAgeMinutes?: number;
  /** Reloj interno para `completedAt`. Nunca se relee del input. */
  now: () => string;
  /** Fallo del loader: el proveedor no se invoca y el caso falla cerrado. */
  loaderError?: string | null;
}

/** Cuántas veces se invocó al proveedor. Debe ser 0 o 1, nunca más. */
export interface OutcomeDiagnostics {
  providerCalls: number;
}

const DIAGNOSTICS = new WeakMap<object, OutcomeDiagnostics>();

/** Diagnóstico del outcome (para pruebas y auditoría). */
export function outcomeDiagnostics(handle: object): OutcomeDiagnostics | null {
  return DIAGNOSTICS.get(handle) ?? null;
}

/**
 * ÚNICO camino a un `EvaluationOutcome`.
 *
 * R6: el flujo canónico **posee** la invocación al proveedor. No existe API
 * pública que produzca un outcome a partir de un `RawProviderPayload` libre.
 *
 * Todo lo que necesita se captura ANTES de la primera frontera async:
 * caseId, entity, selector, pair, referencia exacta del proveedor, identidad
 * efectiva, instante de evaluación, límite de antigüedad y binding. Después del
 * primer `await` no se relee ningún campo mutable del input.
 */
export async function buildEvaluationOutcome(
  input: BuildOutcomeInput
): Promise<EvaluationOutcome> {
  // ══ CAPTURA SÍNCRONA — antes de cualquier await ═══════════════════════
  const caseId = input.caseId;
  const entity = snapshotEntity(input.entity);
  const selector = snapshotSelector(input.selector);
  const pair = snapshotPair(input.pair);
  const binding = caseBinding(caseId, entity.clientId, entity.entityId);
  const evaluatedAt = input.evaluatedAt;
  const maxAge = input.egressMaxAgeMinutes ?? EGRESS_MAX_AGE_MINUTES;
  const loaderError = input.loaderError ?? null;
  const clock = input.now;
  // Referencia EXACTA e identidad efectiva, resueltas una sola vez.
  const provider = input.provider;
  const identity = captureProviderIdentity(provider, input.registry);
  const verifyChain = input.verifyChain;
  // ══ FIN DE LA CAPTURA. De acá en adelante sólo se usan estas constantes. ══

  // Compuerta previa sobre el MISMO snapshot que se va a persistir.
  const gate = validateEvidencePair(pair, entity, evaluatedAt, maxAge, selector, binding);
  const usable =
    loaderError === null && gate.ok && pair.ingress !== null && pair.egress !== null;

  let payload: RawProviderPayload;
  let completedAt: string | null = null;
  let providerCalls = 0;

  if (!usable) {
    payload = {
      outcome: "not_executed",
      error: loaderError
        ? `fallo del loader de evidencia: ${loaderError}`
        : "evidencia inválida o incompleta: no se invoca al proveedor",
    };
  } else {
    try {
      providerCalls += 1;
      // 🔴 R6-1: el proveedor compara EXACTAMENTE las mismas referencias
      // congeladas que después se validan, derivan y persisten.
      payload = await provider.compare({
        ingress: pair.ingress as EvidenceRecord,
        egress: pair.egress as EvidenceRecord,
        requestedAt: evaluatedAt,
      });
      completedAt = clock();
    } catch (e) {
      payload = { outcome: "threw", error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Procedencia desde la identidad CAPTURADA: el registro ya no se consulta.
  const assessment = snapshotAssessment(
    buildAssessmentFromIdentity(identity, payload, evaluatedAt, completedAt)
  );

  // Validación autoritativa sobre el mismo snapshot.
  const evidence = validateEvidencePair(pair, entity, evaluatedAt, maxAge, selector, binding);

  const request: VerifyChainRequest = {
    scope: entity.scope,
    entityId: entity.entityId,
    requiredEventIds: snapshotIds(evidence.eventIds),
    verifiedAtIso: evaluatedAt,
    boundTo: binding,
  };
  const chain = snapshotChain(await verifyChainForCase(verifyChain, request));

  const derived = deriveIntegrityCaseState({ evidence, chain, assessment });

  const parts: EvaluationOutcome = {
    entity,
    selector,
    evidence: pair,
    chain,
    assessment,
    state: derived.state,
    holdReasons: snapshotHoldReasons(derived.reasons),
    evaluatedAt,
  };

  const snapshot = materializeOutcome(parts);
  const handle = materializeOutcome(parts);
  OUTCOMES.set(handle, { binding, snapshot });
  DIAGNOSTICS.set(handle, Object.freeze({ providerCalls }));
  return handle;
}

/**
 * Devuelve el SNAPSHOT privado registrado, nunca los campos del objeto
 * presentado. Mutar el handle después de construirlo no cambia lo que esta
 * función entrega.
 */
export function readEvaluationOutcome(
  value: unknown,
  expectedBinding: string
): EvaluationOutcome | null {
  if (typeof value !== "object" || value === null) return null;
  if (!isNonEmptyId(expectedBinding)) return null;
  const entry = OUTCOMES.get(value as object);
  return entry && entry.binding === expectedBinding ? entry.snapshot : null;
}

// ---------------------------------------------------------------------------
// Constructor canónico de prueba de inspección
// ---------------------------------------------------------------------------

export function buildInspectionProof(
  caseId: string,
  entity: CustodyEntityRef,
  requestedIds: readonly string[],
  loaded: readonly EvidenceRecord[],
  comparedEvidenceIds: readonly string[]
): InspectionProof {
  const e = snapshotEntity(entity);
  const binding = caseBinding(caseId, e.clientId, e.entityId);

  // Snapshots antes de validar: el caller no puede alterar lo que se validó.
  const requested = snapshotIds(requestedIds);
  const rows = Object.freeze(
    loaded.map((r) => snapshotEvidenceRecordStrict(r))
  ) as readonly EvidenceRecord[];
  const compared = snapshotIds(comparedEvidenceIds);

  const v = validateInspectionEvidence(requested, rows, e, compared, binding);

  const parts: InspectionProof = {
    ok: v.ok,
    problems: snapshotIds(v.problems),
    evidenceIds: snapshotIds(v.evidenceIds),
  };
  const snapshot = Object.freeze({ ...parts });
  const handle = Object.freeze({ ...parts });
  PROOFS.set(handle, { binding, snapshot });
  return handle;
}

export function readInspectionProof(
  value: unknown,
  expectedBinding: string
): InspectionProof | null {
  if (typeof value !== "object" || value === null) return null;
  if (!isNonEmptyId(expectedBinding)) return null;
  const entry = PROOFS.get(value as object);
  return entry && entry.binding === expectedBinding ? entry.snapshot : null;
}

/** Variante no-nullable para listas de evidencia. */
function snapshotEvidenceRecordStrict(r: EvidenceRecord): EvidenceRecord {
  return Object.freeze({
    evidenceId: r.evidenceId,
    eventId: r.eventId,
    scope: r.scope,
    entityId: r.entityId,
    clientId: r.clientId,
    stage: r.stage,
    eventType: r.eventType,
    kind: r.kind ?? null,
    sha256: r.sha256,
    capturedAt: r.capturedAt,
    redacted: r.redacted,
  });
}
