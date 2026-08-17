/**
 * VIEW-MODELS DERIVADOS DEL BUILDER REAL, NO FABRICADOS A MANO.
 *
 * ─── POR QUÉ EXISTE ESTE ARCHIVO ──────────────────────────────────────────
 *
 * La batería DOM construía el `CustodyCaseView` literal, campo por campo, con
 * `state: "REVIEW_REQUIRED"` e `inspection: { enabled: true }` escritos a mano.
 * Eso deja de probar el sistema y pasa a probar el literal: la batería dio 221
 * verdes con el circuito muerto en su primer paso, porque ningún caso montado
 * estaba en `PENDING_EVIDENCE` —el estado en el que TODO caso nace— y ningún
 * test podía ver que ahí la captura quedaba deshabilitada.
 *
 * Acá el view-model sale de `buildCustodyCaseView`, el mismo que corre en
 * producción. Si la derivación se rompe, la batería DOM se entera.
 *
 * ─── QUÉ SE PUEDE PISAR Y QUÉ NO ──────────────────────────────────────────
 *
 * `viewOverrides` existe para forzar un panel a un estado concreto sin tener
 * que construir el dominio entero que lo produce. Es legítimo para lo que el
 * test está midiendo —los blockers que se pintan, por ejemplo— y es una
 * trampa para lo que el test cree estar midiendo. Regla simple: no pises
 * `capture` ni `inspection` salvo que el caso bajo prueba SEA justamente el
 * de esos campos.
 */
import {
  buildCustodyCaseView,
  type CustodyCaseView,
} from "@/lib/custody/case-presentation";
import type {
  EvidenceRecord,
  IntegrityCase,
  VerifiedActor,
} from "@/lib/custody/integrity";
import type { CustodyCaseIdentity } from "@/lib/custody/integrity-adapters";

export const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CLIENT = "22222222-2222-4222-8222-222222222222";
export const SHIPMENT = "11111111-1111-4111-8111-111111111111";
export const UNIT = "99999999-9999-4999-8999-999999999999";
export const ING = "33333333-3333-4333-8333-333333333333";
export const EGR = "55555555-5555-4555-8555-555555555555";
export const INSPECCION_ID = "66666666-6666-4666-8666-666666666666";
const SHA = "a".repeat(64);

export const IDENTITY: CustodyCaseIdentity = {
  casePublicId: "CINT-2026-000451",
  clientRazon: "Laboratorio Fénix S.A.",
  clientNameAtReception: "LABORATORIO FENIX",
  unitPublicId: "CPU-2026-000123",
  sku: "MUEBLE-DEMO-01",
  quantity: 1,
  lotNumber: null,
  expirationDate: null,
  receptionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  receptionPublicId: "REC-2026-0088",
};

function evidence(id: string, over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: id,
    eventId: `ev-${id}`,
    scope: "shipment",
    entityId: SHIPMENT,
    clientId: CLIENT,
    stage: "packing",
    eventType: "foto_packing",
    kind: "foto",
    sha256: SHA,
    capturedAt: "2026-08-08T10:15:00.000Z",
    redacted: false,
    ...over,
  };
}

/** Caso de dominio en el mejor estado posible para decidir. */
export function domainCase(over: Partial<IntegrityCase> = {}): IntegrityCase {
  return {
    caseId: CASE_ID,
    version: 3,
    evaluationLease: null,
    entity: { scope: "shipment", entityId: SHIPMENT, clientId: CLIENT },
    selector: { ingressEvidenceId: ING, egressEvidenceId: EGR },
    state: "REVIEW_REQUIRED",
    holdReasons: ["NO_CALIBRATED_THRESHOLD"],
    evidence: {
      ingress: evidence(ING),
      egress: evidence(EGR, { stage: "entrega", eventType: "foto_entrega" }),
    },
    chain: {
      status: "verified",
      attestation: {
        scope: "shipment",
        entityId: SHIPMENT,
        chainHead: "head-1",
        eventsChecked: 4,
        verifiedEventIds: [],
        attestedAt: "2026-08-10T11:30:00.000Z",
      },
    },
    assessment: {
      outcome: "ok",
      verdict: "coincide",
      modelConfidence: 0.87,
      observations: [],
      zones: [],
      provenance: {
        provider: "prov",
        model: "m",
        promptVersion: "v1",
        executionMode: "real",
        requestedAt: "2026-08-10T11:00:00.000Z",
        completedAt: "2026-08-10T11:00:05.000Z",
      },
      error: null,
    },
    decision: null,
    createdAt: "2026-08-08T10:15:00.000Z",
    updatedAt: "2026-08-10T09:42:00.000Z",
    ...over,
  };
}

/**
 * Caso FÍSICO recién materializado por el trigger de 0250a: `PENDING_EVIDENCE`,
 * `EVIDENCE_MISSING`, sin ninguna foto y sin análisis. Es como nace TODO caso,
 * y es el estado que la batería anterior no montaba nunca.
 */
export function nacienteFisico(over: Partial<IntegrityCase> = {}): IntegrityCase {
  return domainCase({
    entity: { scope: "physical_unit", entityId: UNIT, clientId: CLIENT },
    selector: { ingressEvidenceId: null, egressEvidenceId: null },
    state: "PENDING_EVIDENCE",
    holdReasons: ["EVIDENCE_MISSING"],
    evidence: { ingress: null, egress: null },
    chain: null,
    assessment: null,
    ...over,
  });
}

/**
 * Caso FÍSICO con el par de fotos ya registrado y análisis al día. Es el estado
 * en el que tienen sentido los paneles de inspección, re-evaluación y decisión.
 */
export function fisicoConPar(over: Partial<IntegrityCase> = {}): IntegrityCase {
  return domainCase({
    entity: { scope: "physical_unit", entityId: UNIT, clientId: CLIENT },
    evidence: {
      ingress: evidence(ING, { scope: "physical_unit", entityId: UNIT, stage: "recepcion", eventType: "foto_ingreso" }),
      egress: evidence(EGR, { scope: "physical_unit", entityId: UNIT, stage: "despacho", eventType: "foto_egreso" }),
    },
    chain: {
      status: "verified",
      attestation: {
        scope: "physical_unit",
        entityId: UNIT,
        chainHead: "head-1",
        eventsChecked: 4,
        verifiedEventIds: [],
        attestedAt: "2026-08-10T11:30:00.000Z",
      },
    },
    ...over,
  });
}

export function actor(over: Partial<VerifiedActor> = {}): VerifiedActor {
  return {
    subjectType: "human_session",
    userId: "77777777-7777-4777-8777-777777777777",
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    clientId: CLIENT,
    role: "admin",
    // `wms.edit` es el permiso de CAPTURA; `wms.custody.decide` el de decisión.
    permissions: ["wms.custody.decide", "wms.edit"],
    ...over,
  };
}

export interface DerivedOptions {
  case?: Partial<IntegrityCase>;
  actor?: Partial<VerifiedActor> | null;
  identity?: CustodyCaseIdentity | null;
  candidateInspectionEvidenceIds?: readonly string[];
  chainAdvanced?: boolean;
  evaluationInFlight?: boolean;
  podPdfReady?: boolean;
  draftReason?: string;
  /** Base de dominio alternativa (p. ej. `nacienteFisico`). */
  base?: (over?: Partial<IntegrityCase>) => IntegrityCase;
}

/** View-model REAL, producido por el mismo builder que corre en producción. */
export function derivedView(
  opts: DerivedOptions = {},
  viewOverrides: Partial<CustodyCaseView> = {},
): CustodyCaseView {
  const base = opts.base ?? domainCase;
  const derived = buildCustodyCaseView({
    case: base(opts.case ?? {}),
    actor: opts.actor === null ? null : actor(opts.actor ?? {}),
    identity: opts.identity === undefined ? IDENTITY : opts.identity,
    candidateInspectionEvidenceIds: opts.candidateInspectionEvidenceIds,
    chainAdvanced: opts.chainAdvanced,
    evaluationInFlight: opts.evaluationInFlight,
    podPdfReady: opts.podPdfReady,
    draftReason: opts.draftReason,
  });
  return { ...derived, ...viewOverrides };
}
