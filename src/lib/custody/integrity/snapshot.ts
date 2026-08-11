/**
 * Snapshots defensivos por tipo. R5.
 *
 * `Object.freeze` es SUPERFICIAL. El C4 lo demostró: un outcome «congelado»
 * seguía exponiendo `evidence.ingress`, `chain.attestation`, `assessment.
 * provenance` y sus arrays como referencias mutables, así que se podía derivar
 * `state`/`holdReasons` con evidencia válida y después marcarla `redacted` sin
 * que nada lo notara.
 *
 * Acá se clona y congela **cada nivel**, con funciones explícitas por tipo. No
 * se usa `JSON.parse(JSON.stringify(...))`: pierde `undefined`, rompe fechas y
 * enmascara formas inesperadas en vez de copiarlas de manera predecible.
 */

import type {
  ChainAttestation,
  ChainVerification,
  CustodyEntityRef,
  EvidencePairSelector,
  EvidenceRecord,
  HoldReason,
  IntegrityAssessment,
  ProviderProvenance,
} from "./types";

/** Copia congelada de un array de primitivos. */
function frozenList<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

export function snapshotEntity(e: CustodyEntityRef): CustodyEntityRef {
  return Object.freeze({ scope: e.scope, entityId: e.entityId, clientId: e.clientId });
}

export function snapshotSelector(s: EvidencePairSelector): EvidencePairSelector {
  return Object.freeze({
    ingressEvidenceId: s.ingressEvidenceId,
    egressEvidenceId: s.egressEvidenceId,
  });
}

export function snapshotEvidenceRecord(r: EvidenceRecord | null): EvidenceRecord | null {
  if (r === null || typeof r !== "object") return null;
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

export function snapshotPair(p: {
  ingress: EvidenceRecord | null;
  egress: EvidenceRecord | null;
}): { ingress: EvidenceRecord | null; egress: EvidenceRecord | null } {
  return Object.freeze({
    ingress: snapshotEvidenceRecord(p.ingress),
    egress: snapshotEvidenceRecord(p.egress),
  });
}

export function snapshotAttestation(a: ChainAttestation): ChainAttestation {
  return Object.freeze({
    scope: a.scope,
    entityId: a.entityId,
    chainHead: a.chainHead,
    eventsChecked: a.eventsChecked,
    verifiedEventIds: frozenList(a.verifiedEventIds ?? []),
    attestedAt: a.attestedAt,
  });
}

export function snapshotChain(c: ChainVerification): ChainVerification {
  switch (c.status) {
    case "verified":
      return Object.freeze({
        status: "verified" as const,
        attestation: snapshotAttestation(c.attestation),
      });
    case "invalid":
      return Object.freeze({
        status: "invalid" as const,
        eventsChecked: c.eventsChecked,
        verifiedAt: c.verifiedAt,
        firstError: c.firstError
          ? Object.freeze({
              publicId: c.firstError.publicId,
              chainSeq: c.firstError.chainSeq,
              reason: c.firstError.reason,
            })
          : null,
      });
    case "unverifiable":
      return Object.freeze({
        status: "unverifiable" as const,
        verifiedAt: c.verifiedAt,
        error: c.error,
      });
  }
}

export function snapshotProvenance(p: ProviderProvenance): ProviderProvenance {
  return Object.freeze({
    provider: p.provider,
    model: p.model,
    promptVersion: p.promptVersion,
    executionMode: p.executionMode,
    requestedAt: p.requestedAt,
    completedAt: p.completedAt,
  });
}

export function snapshotAssessment(a: IntegrityAssessment): IntegrityAssessment {
  return Object.freeze({
    outcome: a.outcome,
    verdict: a.verdict,
    modelConfidence: a.modelConfidence,
    // Congeladas, no sólo copiadas: un `push` sobre el handle no debe poder
    // alterar el snapshot autoritativo.
    observations: Object.freeze([...(a.observations ?? [])]) as string[],
    zones: Object.freeze([...(a.zones ?? [])]) as string[],
    provenance: snapshotProvenance(a.provenance),
    error: a.error,
  }) as IntegrityAssessment;
}

export function snapshotHoldReasons(h: readonly HoldReason[]): readonly HoldReason[] {
  return frozenList(h);
}

export function snapshotIds(ids: readonly string[]): readonly string[] {
  return frozenList(ids);
}

/**
 * Comprobación de invariancia usada por las pruebas: dos snapshots del mismo
 * origen deben ser estructuralmente idénticos.
 */
export function evidenceRecordEquals(
  a: EvidenceRecord | null,
  b: EvidenceRecord | null
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.evidenceId === b.evidenceId &&
    a.eventId === b.eventId &&
    a.scope === b.scope &&
    a.entityId === b.entityId &&
    a.clientId === b.clientId &&
    a.stage === b.stage &&
    a.eventType === b.eventType &&
    (a.kind ?? null) === (b.kind ?? null) &&
    a.sha256 === b.sha256 &&
    a.capturedAt === b.capturedAt &&
    a.redacted === b.redacted
  );
}
