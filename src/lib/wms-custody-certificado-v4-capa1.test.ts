/**
 * V4 · CAPA 1 · LA DECISIÓN TRANSPORTA SUS IDS DE INSPECCIÓN (R-19).
 *
 * ROJO (medible en el árbol previo a V4, sin tocar este archivo): la base
 * persiste los ids en `custody_integrity_inspection_evidence` (0251:243-244) y
 * `mapDecision` los fijaba en `[]`, así que una decisión con N ids llegaba a
 * la política como lista vacía y disparaba `NO_INSPECTION_EVIDENCE`.
 *
 * VERDE: `buildIntegrityCase` pregunta al puerto por los ids de la decisión y
 * la decisión los devuelve. Sin puerto que sepa leerlos —dobles viejos— la
 * lista queda vacía: el mismo lado fail-closed de siempre, ahora deliberado.
 */
import { describe, expect, it } from "vitest";

import {
  buildIntegrityCase,
  type CustodyQueryPort,
  type RawCaseRow,
  type RawDecisionRow,
} from "@/lib/custody/integrity-adapters";
import { evaluateCertificateEligibility } from "@/lib/custody/integrity/certificate-policy";
import type { CertificateContext } from "@/lib/custody/integrity/certificate-policy";

const CASE_ROW: RawCaseRow = {
  id: "case-1",
  version: 3,
  client_id: "client-1",
  physical_unit_id: "pu-1",
  packing_unit_id: null,
  shipment_id: null,
  state: "RELEASED",
  hold_reasons: [],
  ingress_evidence_id: null,
  egress_evidence_id: null,
  provider: null,
  model: null,
  prompt_version: null,
  execution_mode: null,
  outcome: null,
  verdict: null,
  model_confidence: null,
  provider_error: null,
  chain_status: null,
  chain_events_checked: null,
  chain_head: null,
  chain_attested_at: null,
  decision_id: "dec-1",
  created_at: "2026-08-18T12:00:00.000Z",
  updated_at: "2026-08-18T12:05:00.000Z",
};

const DECISION_ROW: RawDecisionRow = {
  id: "dec-1",
  decision: "release",
  actor_user_id: "user-1",
  actor_session_id: "sess-1",
  actor_role: "admin",
  client_id: "client-1",
  reason: "Inspección física completa y conforme.",
  observations: null,
  decided_at: "2026-08-18T12:05:00.000Z",
  previous_state: "REVIEW_REQUIRED",
  new_state: "RELEASED",
  chain_head_at_decision: "a".repeat(64),
};

function port(overrides: Partial<CustodyQueryPort>): CustodyQueryPort {
  return {
    selectCase: async () => CASE_ROW,
    selectDecision: async () => DECISION_ROW,
    selectEvidence: async () => [],
    verifyChainHead: async () => null,
    selectProfile: async () => null,
    selectPermissions: async () => [],
    decide: async () => "dec-1",
    beginEvaluation: async () => "att-1",
    selectInspectionCandidates: async () => [],
    selectActiveAttempt: async () => null,
    ...overrides,
  };
}

describe("V4 · capa 1 · los ids persistidos llegan a la decisión", () => {
  it("VERDE · decisión con N ids persistidos ⇒ la decisión devuelve los N", async () => {
    const ids = ["ev-insp-1", "ev-insp-2"];
    const built = await buildIntegrityCase(
      port({ selectDecisionInspectionEvidence: async (decisionId) => {
        expect(decisionId).toBe("dec-1");
        return [...ids];
      } }),
      CASE_ROW,
    );
    expect(built.decision?.inspectionEvidenceIds).toEqual(ids);
  });

  it("fail-closed · sin puerto que lea los ids, la lista queda vacía", async () => {
    const built = await buildIntegrityCase(port({}), CASE_ROW);
    expect(built.decision?.inspectionEvidenceIds).toEqual([]);
  });

  it("fail-closed · si la lectura de ids revienta, la lista queda vacía", async () => {
    const built = await buildIntegrityCase(
      port({ selectDecisionInspectionEvidence: async () => {
        throw new Error("rls");
      } }),
      CASE_ROW,
    );
    expect(built.decision?.inspectionEvidenceIds).toEqual([]);
  });
});

describe("V4 · capa 1 · el vínculo con la política (el rojo, ejecutable)", () => {
  const ctx = (inspectionEvidenceIds: readonly string[]): CertificateContext => ({
    state: "RELEASED",
    caseClientId: "client-1",
    requesterClientId: "client-1",
    evidenceOk: true,
    evidenceEventIds: ["evt-in", "evt-out"],
    chain: null,
    assessment: null,
    decision: {
      decision: "release",
      actorUserId: "user-1",
      actorSessionId: "sess-1",
      actorRole: "admin",
      clientId: "client-1",
      permission: "wms.custody.decide",
      decidedAt: "2026-08-18T12:05:00.000Z",
      reason: "Inspección física completa y conforme.",
      observations: null,
      inspectionEvidenceIds: [...inspectionEvidenceIds],
      previousState: "REVIEW_REQUIRED",
      newState: "RELEASED",
      chainHeadAtDecision: "a".repeat(64),
    },
    canonicalInspectionEvidenceIds: ["ev-insp-1"],
    currentChainHead: "a".repeat(64),
    issuedAt: "2026-08-18T12:06:00.000Z",
  });

  it("ROJO · decisión con lista vacía ⇒ NO_INSPECTION_EVIDENCE", () => {
    const r = evaluateCertificateEligibility(ctx([]));
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toContain("NO_INSPECTION_EVIDENCE");
  });

  it("VERDE · decisión con sus ids ⇒ NO_INSPECTION_EVIDENCE no dispara", () => {
    const r = evaluateCertificateEligibility(ctx(["ev-insp-1"]));
    expect(r.blockers).not.toContain("NO_INSPECTION_EVIDENCE");
  });
});
