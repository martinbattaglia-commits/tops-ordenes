/**
 * V4-bis · EL CERTIFICADO SOBREVIVE A LOS EVENTOS POSTERIORES A LA LIBERACIÓN
 * (R-19 · pares rojo→verde del expediente CUSTODIA-CERTIFICADO-VIGENCIA).
 *
 * ROJO (medido en el árbol previo a V4-bis, `certificate-policy.ts:124-128`):
 * un caso liberado con un evento `pod` posterior daba `acta_inspeccion` con
 * `DECISION_CHAIN_HEAD_MISMATCH` (condiciones contra la punta VIVA:
 * `d.chainHeadAtDecision !== ctx.currentChainHead` y los dos
 * `isAttestationCurrent(…, ctx.currentChainHead, …)`), más
 * `CHAIN_ATTESTATION_STALE` (vigencia medida en `issuedAt` contra la viva) y
 * `EVIDENCE_NOT_LINKED` (`buildDocumentChain` exigía igualdad de heads y la
 * lista almacenada quedaba vacía). El certificado era emisible sólo entre la
 * liberación y el primer evento posterior, y a lo sumo 60 minutos.
 *
 * VERDE (decisión firmada de Dirección): la verificación se hace CONTRA EL
 * TESTIGO —la punta que la decisión atestó— en el instante de la decisión.
 *
 * INVARIANTE QUE NO SE PUEDE ROMPER, en su dirección: cadena ROTA después de
 * la liberación → SIGUE dando acta. Nunca certificado donde correspondía acta.
 *
 * Y la compuerta de tenant no se afloja: un cliente distinto jamás obtiene el
 * certificado de otro (la compuerta literal de 0254/0258 vive en la base; acá
 * se prueba el espejo de aplicación: `CLIENT_MISMATCH`).
 */
import { describe, expect, it } from "vitest";

import { buildDocumentChain } from "@/lib/custody/integrity/certificate-document";
import { evaluateCertificateEligibility } from "@/lib/custody/integrity/certificate-policy";
import type { CertificateContext } from "@/lib/custody/integrity/certificate-policy";
import type {
  ChainVerification,
  HumanDecisionRecord,
  IntegrityAssessment,
} from "@/lib/custody/integrity/types";
import { CUSTODY_DECISION_PERMISSION } from "@/lib/custody/integrity/types";

const CLIENT = "client-alpha";
const OTHER_CLIENT = "client-beta";

/** El testigo: head de la cadena que la decisión atestó. */
const WITNESS_HEAD = "w".repeat(64);
/** La punta viva DESPUÉS del pod: otro hash, cadena avanzada. */
const LIVE_HEAD_AFTER_POD = "p".repeat(64);

const ATTESTED_AT = "2026-08-17T12:00:00.000Z";
const DECIDED_AT = "2026-08-17T12:05:00.000Z";
/** El cliente entra AL DÍA SIGUIENTE a bajar su certificado. */
const ISSUED_NEXT_DAY = "2026-08-18T12:05:00.000Z";

/** Atestación almacenada en el caso: la de la decisión, lista vacía (mapChain). */
const STORED: ChainVerification = {
  status: "verified",
  attestation: {
    scope: "physical_unit",
    entityId: "pu-1",
    chainHead: WITNESS_HEAD,
    eventsChecked: 4,
    verifiedEventIds: [],
    attestedAt: ATTESTED_AT,
  },
};

/** La viva tras el pod: cadena ÍNTEGRA, head avanzado, ids completos. */
const LIVE_AFTER_POD = {
  status: "verified",
  chainHead: LIVE_HEAD_AFTER_POD,
  verifiedEventIds: ["evt-in", "evt-out", "evt-insp", "evt-pod"],
};

/** La viva tras una ADULTERACIÓN: la verificación de cadena completa rompe. */
const LIVE_BROKEN = {
  status: "invalid",
  chainHead: LIVE_HEAD_AFTER_POD,
  verifiedEventIds: [],
};

const DECISION: HumanDecisionRecord = {
  decision: "release",
  actorUserId: "user-1",
  actorSessionId: "sess-1",
  actorRole: "supervisor",
  clientId: CLIENT,
  permission: CUSTODY_DECISION_PERMISSION,
  decidedAt: DECIDED_AT,
  reason: "inspección física conforme, se libera",
  observations: null,
  inspectionEvidenceIds: ["ev-insp"],
  previousState: "REVIEW_REQUIRED",
  newState: "RELEASED",
  chainHeadAtDecision: WITNESS_HEAD,
};

const ASSESSMENT: IntegrityAssessment = {
  outcome: "ok",
  verdict: "coincide",
  modelConfidence: 0.93,
  similarityScore: 97,
  thresholdPercent: 90,
  thresholdResult: "ABOVE_OR_EQUAL",
  scoreComponents: { identity: 97, packaging: 96, quantity: 98, condition: 97 },
  packagingChanged: false,
  missingItemsSuspected: false,
  damageSuspected: false,
  provenance: {
    executionMode: "real",
    provider: "openai",
    model: "gpt-5",
    promptVersion: "v1",
  },
} as unknown as IntegrityAssessment;

/** El contexto tal como lo arma la acción de documento al día siguiente. */
function podPosteriorCtx(over: Partial<CertificateContext> = {}): CertificateContext {
  return {
    state: "RELEASED",
    caseClientId: CLIENT,
    requesterClientId: CLIENT,
    evidenceOk: true,
    evidenceEventIds: ["evt-in", "evt-out"],
    chain: buildDocumentChain(STORED, LIVE_AFTER_POD),
    assessment: ASSESSMENT,
    decision: DECISION,
    canonicalInspectionEvidenceIds: ["ev-insp"],
    currentChainHead: LIVE_HEAD_AFTER_POD,
    issuedAt: ISSUED_NEXT_DAY,
    ...over,
  };
}

describe("V4-bis · par rojo→verde · pod posterior a la liberación", () => {
  it("VERDE · caso liberado + pod posterior + emisión al día siguiente ⇒ certificate sin bloqueos", () => {
    const r = evaluateCertificateEligibility(podPosteriorCtx());
    expect(r).toEqual({ document: "certificate", blockers: [] });
  });

  it("VERDE · cualquier evento posterior (entrega, entregado, foto_entrega, en_transito) ⇒ certificate", () => {
    const live = {
      status: "verified",
      chainHead: "z".repeat(64),
      verifiedEventIds: [
        "evt-in", "evt-out", "evt-insp", "evt-pod",
        "evt-entrega", "evt-entregado", "evt-foto-entrega", "evt-transito",
      ],
    };
    const r = evaluateCertificateEligibility(
      podPosteriorCtx({ chain: buildDocumentChain(STORED, live), currentChainHead: live.chainHead }),
    );
    expect(r).toEqual({ document: "certificate", blockers: [] });
  });
});

describe("V4-bis · invariante fail-closed · cadena ROTA ⇒ SIGUE dando acta", () => {
  it("adulteración posterior a la liberación: la viva no verifica ⇒ acta", () => {
    // La cadena rota deja a la atestación almacenada con su lista vacía:
    // las evidencias no quedan acreditadas y el documento degrada.
    const r = evaluateCertificateEligibility(
      podPosteriorCtx({ chain: buildDocumentChain(STORED, LIVE_BROKEN) }),
    );
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toContain("EVIDENCE_NOT_LINKED");
  });

  it("cadena rota Y almacenada no verificada ⇒ acta por CHAIN_NOT_VERIFIED", () => {
    const unverifiable: ChainVerification = {
      status: "unverifiable",
      verifiedAt: DECIDED_AT,
      error: "attestation_incomplete",
    };
    const r = evaluateCertificateEligibility(
      podPosteriorCtx({ chain: buildDocumentChain(unverifiable, LIVE_BROKEN) }),
    );
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toContain("CHAIN_NOT_VERIFIED");
  });

  it("el testigo NO verificable (atestación vencida al decidir) ⇒ acta", () => {
    const lateDecision = {
      ...DECISION,
      decidedAt: new Date(Date.parse(ATTESTED_AT) + 120 * 60_000).toISOString(),
    };
    const r = evaluateCertificateEligibility(podPosteriorCtx({ decision: lateDecision }));
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toEqual(
      expect.arrayContaining(["DECISION_CHAIN_HEAD_MISMATCH", "CHAIN_ATTESTATION_STALE"]),
    );
  });

  it("el testigo NO coincide con la atestación que sostuvo la decisión ⇒ acta", () => {
    const foreignWitness = { ...DECISION, chainHeadAtDecision: "x".repeat(64) };
    const r = evaluateCertificateEligibility(podPosteriorCtx({ decision: foreignWitness }));
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toContain("DECISION_CHAIN_HEAD_MISMATCH");
  });
});

describe("V4-bis · tenant ajeno · la supervivencia no afloja la compuerta", () => {
  it("otro cliente pide el documento del caso pod-posterior certificable ⇒ acta con CLIENT_MISMATCH", () => {
    const r = evaluateCertificateEligibility(podPosteriorCtx({ requesterClientId: OTHER_CLIENT }));
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toContain("CLIENT_MISMATCH");
  });
});
