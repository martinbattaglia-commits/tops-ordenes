/**
 * Validación de evidencia. Módulo puro.
 *
 * REVISIÓN 3. Añade lo que el C4 final exigió:
 *  · el id devuelto por el loader debe coincidir EXACTAMENTE con el solicitado
 *    (un loader que devuelva C/D para un selector A/B ya no pasa);
 *  · se valida el PAR (stage, eventType), no sólo el tipo;
 *  · la evidencia de inspección se revalida después del loader.
 */

import {
  EGRESS_PAIRS,
  INGRESS_PAIRS,
  INSPECTION_EVIDENCE_KIND,
  INSPECTION_PAIRS,
  type CustodyEntityRef,
  type CustodyEventType,
  type CustodyStage,
  type EvidencePairSelector,
  type EvidenceRecord,
  type EvidenceValidation,
  type HoldReason,
  type InspectionEvidenceProblem,
  type InspectionEvidenceValidation,
} from "./types";
import { sealArtifact } from "./sealed";
import {
  isIsoInstant,
  isNonEmptyId,
  isSha256Hex,
  isValidWindowMinutes,
  msBetween,
  normalizeDigest,
} from "./validation";

export const EGRESS_MAX_AGE_MINUTES = 120;
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

function push<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

function matchesPair(
  rec: EvidenceRecord,
  pairs: ReadonlyArray<readonly [CustodyStage, CustodyEventType]>
): boolean {
  return pairs.some(([stage, type]) => rec.stage === stage && rec.eventType === type);
}

function validateShape(rec: EvidenceRecord, problems: HoldReason[]): boolean {
  let ok = true;
  if (!isNonEmptyId(rec.evidenceId) || !isNonEmptyId(rec.eventId)) {
    push(problems, "EVIDENCE_NOT_FOUND");
    ok = false;
  }
  if (!isSha256Hex(rec.sha256)) {
    push(problems, "EVIDENCE_MALFORMED_DIGEST");
    ok = false;
  }
  if (!isIsoInstant(rec.capturedAt)) {
    push(problems, "EVIDENCE_MALFORMED_TIMESTAMP");
    ok = false;
  }
  return ok;
}

function belongs(rec: EvidenceRecord, entity: CustodyEntityRef, problems: HoldReason[]): void {
  if (rec.clientId !== entity.clientId) push(problems, "EVIDENCE_FOREIGN_CLIENT");
  if (rec.scope !== entity.scope || rec.entityId !== entity.entityId) {
    push(problems, "EVIDENCE_FOREIGN_ENTITY");
  }
}

/**
 * Valida el par cargado contra la entidad y contra el selector solicitado.
 *
 * `maxAgeMinutes` es server-controlled: un valor no finito, no positivo o
 * desmesurado NO se tolera, cae al default. Nadie desactiva la ventana.
 */
export function validateEvidencePair(
  pair: { ingress: EvidenceRecord | null; egress: EvidenceRecord | null },
  entity: CustodyEntityRef,
  evaluatedAtIso: string,
  maxAgeMinutes: number = EGRESS_MAX_AGE_MINUTES,
  selector?: EvidencePairSelector,
  boundTo = ""
): EvidenceValidation {
  const problems: HoldReason[] = [];
  const { ingress, egress } = pair;

  if (!ingress || !egress) {
    return sealArtifact("evidence-validation", boundTo, { ok: false, problems: ["EVIDENCE_MISSING"] as HoldReason[], eventIds: [] });
  }
  if (!isIsoInstant(evaluatedAtIso)) {
    return sealArtifact("evidence-validation", boundTo, { ok: false, problems: ["EVIDENCE_MALFORMED_TIMESTAMP"] as HoldReason[], eventIds: [] });
  }

  // El loader debe haber devuelto EXACTAMENTE lo pedido.
  if (selector) {
    if (
      ingress.evidenceId !== selector.ingressEvidenceId ||
      egress.evidenceId !== selector.egressEvidenceId
    ) {
      push(problems, "EVIDENCE_ID_MISMATCH");
    }
  }

  const window = isValidWindowMinutes(maxAgeMinutes) ? maxAgeMinutes : EGRESS_MAX_AGE_MINUTES;
  const shapeOk = validateShape(ingress, problems) && validateShape(egress, problems);

  belongs(ingress, entity, problems);
  belongs(egress, entity, problems);

  // Par (stage, eventType), no sólo el tipo.
  if (!matchesPair(ingress, INGRESS_PAIRS)) push(problems, "EVIDENCE_WRONG_STAGE");
  if (!matchesPair(egress, EGRESS_PAIRS)) push(problems, "EVIDENCE_WRONG_STAGE");

  if (ingress.redacted || egress.redacted) push(problems, "EVIDENCE_REDACTED");

  const sameDigest =
    shapeOk && normalizeDigest(ingress.sha256) === normalizeDigest(egress.sha256);
  if (sameDigest || ingress.evidenceId === egress.evidenceId || ingress.eventId === egress.eventId) {
    push(problems, "EVIDENCE_SAME_IMAGE");
  }

  if (shapeOk) {
    if (msBetween(ingress.capturedAt, egress.capturedAt) <= 0) {
      push(problems, "EVIDENCE_OUT_OF_ORDER");
    }
    for (const rec of [ingress, egress]) {
      if (msBetween(evaluatedAtIso, rec.capturedAt) > CLOCK_SKEW_TOLERANCE_MS) {
        push(problems, "EVIDENCE_FUTURE");
      }
    }
    if (msBetween(egress.capturedAt, evaluatedAtIso) > window * 60_000) {
      push(problems, "EVIDENCE_STALE");
    }
  }

  return sealArtifact("evidence-validation", boundTo, {
    ok: problems.length === 0,
    problems,
    eventIds: problems.length === 0 ? [ingress.eventId, egress.eventId] : [],
  });
}

/**
 * Revalida la evidencia de inspección devuelta por el loader.
 *
 * D1 · Reconoce EXACTAMENTE `(despacho, inspeccion_humana)` con soporte `foto`,
 * mínimo una, no redactada, de la misma entidad y el mismo cliente, y distinta
 * de las dos que se compararon. Todo lo demás sigue siendo rechazo.
 *
 * La guarda de lista vacía se conserva a propósito: si alguien volviera a
 * vaciar `INSPECTION_PAIRS`, la función tiene que fallar cerrado en vez de
 * aceptar cualquier par.
 */
export function validateInspectionEvidence(
  requestedIds: readonly string[],
  loaded: readonly EvidenceRecord[],
  entity: CustodyEntityRef,
  comparedEvidenceIds: readonly string[],
  boundTo = ""
): InspectionEvidenceValidation {
  const problems: InspectionEvidenceProblem[] = [];

  if (INSPECTION_PAIRS.length === 0) {
    return sealArtifact("inspection-proof", boundTo, {
      ok: false,
      problems: ["INSPECTION_NOT_REPRESENTABLE_IN_SCHEMA"] as InspectionEvidenceProblem[],
      evidenceIds: [] as string[],
    });
  }

  const requested = new Set(requestedIds);
  const seen = new Set<string>();

  for (const rec of loaded) {
    if (!requested.has(rec.evidenceId)) push(problems, "INSPECTION_ID_MISMATCH");
    if (seen.has(rec.evidenceId)) push(problems, "INSPECTION_DUPLICATED");
    seen.add(rec.evidenceId);

    if (rec.clientId !== entity.clientId) push(problems, "INSPECTION_FOREIGN_CLIENT");
    if (rec.scope !== entity.scope || rec.entityId !== entity.entityId) {
      push(problems, "INSPECTION_FOREIGN_ENTITY");
    }
    if (rec.redacted) push(problems, "INSPECTION_REDACTED");
    if (comparedEvidenceIds.includes(rec.evidenceId)) push(problems, "INSPECTION_SAME_AS_COMPARED");
    if (!matchesPair(rec, INSPECTION_PAIRS)) push(problems, "INSPECTION_NOT_REPRESENTABLE_IN_SCHEMA");
    // D1 · el soporte es parte del contrato, no un detalle de presentación: una
    // firma o un PDF no acreditan una inspección física.
    if (rec.kind !== INSPECTION_EVIDENCE_KIND) push(problems, "INSPECTION_WRONG_KIND");
  }

  // Todo id solicitado debe haber sido resuelto.
  if (loaded.length !== requested.size) push(problems, "INSPECTION_ID_MISMATCH");

  return sealArtifact("inspection-proof", boundTo, {
    ok: problems.length === 0 && loaded.length > 0,
    problems,
    evidenceIds: problems.length === 0 ? [...seen] : [],
  });
}
