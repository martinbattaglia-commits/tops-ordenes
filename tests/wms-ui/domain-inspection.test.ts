/**
 * WMS UI-1 · D1 · Dominio de la inspección humana.
 *
 * Estas pruebas se escribieron contra el estado ANTERIOR, donde
 * `INSPECTION_PAIRS` estaba vacío y `validateInspectionEvidence` fallaba
 * SIEMPRE con `INSPECTION_NOT_REPRESENTABLE_IN_SCHEMA`. Cada caso positivo de
 * acá abajo era rojo antes del cambio autorizado por Dirección.
 *
 * Lo que NO cambia y se vuelve a fijar: la IA no libera, y la liberación sigue
 * exigiendo actor humano autorizado, cadena verificada y evaluación real.
 */
import { describe, expect, it } from "vitest";
import {
  applyHumanDecision,
  evaluateReleaseEligibility,
  INSPECTION_EVIDENCE_KIND,
  INSPECTION_PAIRS,
  validateInspectionEvidence,
  type CustodyEntityRef,
  type EvidenceRecord,
  type IntegrityAssessment,
  type VerifiedActor,
} from "@/lib/custody/integrity";

const ENTITY: CustodyEntityRef = {
  scope: "shipment",
  entityId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
};

const SHA = "a".repeat(64);

function evidence(over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: "33333333-3333-4333-8333-333333333333",
    eventId: "44444444-4444-4444-8444-444444444444",
    scope: ENTITY.scope,
    entityId: ENTITY.entityId,
    clientId: ENTITY.clientId,
    stage: "despacho",
    eventType: "inspeccion_humana",
    kind: "foto",
    sha256: SHA,
    capturedAt: "2026-08-10T12:00:00.000Z",
    redacted: false,
    ...over,
  };
}

describe("D1 · el par autorizado es EXACTAMENTE uno", () => {
  it("INSPECTION_PAIRS contiene sólo (despacho, inspeccion_humana)", () => {
    expect(INSPECTION_PAIRS).toHaveLength(1);
    expect(INSPECTION_PAIRS[0]).toEqual(["despacho", "inspeccion_humana"]);
    expect(INSPECTION_EVIDENCE_KIND).toBe("foto");
  });

  it("una foto de inspección canónica ACREDITA (antes era imposible)", () => {
    const v = validateInspectionEvidence(
      [evidence().evidenceId],
      [evidence()],
      ENTITY,
      ["55555555-5555-4555-8555-555555555555"],
    );
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.evidenceIds).toEqual([evidence().evidenceId]);
  });
});

describe("D1 · mutantes: todo lo que NO es el par autorizado se rechaza", () => {
  const mutantes: Array<[string, Partial<EvidenceRecord>, string]> = [
    ["otra etapa", { stage: "entrega" }, "INSPECTION_NOT_REPRESENTABLE_IN_SCHEMA"],
    ["otro tipo de evento", { eventType: "foto_entrega" }, "INSPECTION_NOT_REPRESENTABLE_IN_SCHEMA"],
    ["etapa packing", { stage: "packing", eventType: "foto_packing" }, "INSPECTION_NOT_REPRESENTABLE_IN_SCHEMA"],
    ["soporte firma", { kind: "firma" }, "INSPECTION_WRONG_KIND"],
    ["soporte documento", { kind: "documento" }, "INSPECTION_WRONG_KIND"],
    ["sin soporte informado", { kind: null }, "INSPECTION_WRONG_KIND"],
    ["evidencia redactada", { redacted: true }, "INSPECTION_REDACTED"],
    ["otro cliente", { clientId: "99999999-9999-4999-8999-999999999999" }, "INSPECTION_FOREIGN_CLIENT"],
    ["otra entidad", { entityId: "88888888-8888-4888-8888-888888888888" }, "INSPECTION_FOREIGN_ENTITY"],
  ];

  it.each(mutantes)("%s ⇒ %s", (_label, over, problem) => {
    const rec = evidence(over);
    const v = validateInspectionEvidence([rec.evidenceId], [rec], ENTITY, []);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain(problem);
    expect(v.evidenceIds).toEqual([]);
  });

  it("cero evidencias NO acredita: el mínimo es una", () => {
    const v = validateInspectionEvidence([], [], ENTITY, []);
    expect(v.ok).toBe(false);
  });

  it("la misma foto que se comparó no puede además acreditar la inspección", () => {
    const rec = evidence();
    const v = validateInspectionEvidence([rec.evidenceId], [rec], ENTITY, [rec.evidenceId]);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("INSPECTION_SAME_AS_COMPARED");
  });

  it("un id pedido que el loader no resolvió invalida el conjunto", () => {
    const rec = evidence();
    const v = validateInspectionEvidence(
      [rec.evidenceId, "66666666-6666-4666-8666-666666666666"],
      [rec],
      ENTITY,
      [],
    );
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("INSPECTION_ID_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// NO_AUTOMATIC_RELEASE
// ---------------------------------------------------------------------------

const OK_ASSESSMENT: IntegrityAssessment = {
  outcome: "ok",
  verdict: "coincide",
  modelConfidence: 0.99,
  observations: [],
  zones: [],
  provenance: {
    provider: "p",
    model: "m",
    promptVersion: "v1",
    executionMode: "real",
    requestedAt: "2026-08-10T11:00:00.000Z",
    completedAt: "2026-08-10T11:00:05.000Z",
  },
  error: null,
};

const ADMIN: VerifiedActor = {
  subjectType: "human_session",
  userId: "77777777-7777-4777-8777-777777777777",
  sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  clientId: ENTITY.clientId,
  role: "admin",
  permissions: ["wms.custody.decide"],
};

const RELEASE_CTX = {
  holdReasons: ["NO_CALIBRATED_THRESHOLD"] as const,
  evidenceOk: true,
  chain: {
    status: "verified" as const,
    attestation: {
      scope: ENTITY.scope,
      entityId: ENTITY.entityId,
      chainHead: "head-1",
      eventsChecked: 4,
      verifiedEventIds: [],
      attestedAt: "2026-08-10T11:30:00.000Z",
    },
  },
  assessment: OK_ASSESSMENT,
};

describe("NO_AUTOMATIC_RELEASE · la IA informa, nunca libera", () => {
  it("veredicto perfecto SIN inspección humana ⇒ no se libera", () => {
    const e = evaluateReleaseEligibility({
      state: "REVIEW_REQUIRED",
      ...RELEASE_CTX,
      canonicalInspectionEvidenceIds: [],
      reason: "revisión completa del bulto",
    });
    expect(e.allowed).toBe(false);
    expect(e.blockers).toContain("NO_HUMAN_INSPECTION_EVIDENCE");
  });

  it("veredicto perfecto CON inspección humana y actor admin ⇒ recién ahí libera", () => {
    const out = applyHumanDecision({
      currentState: "REVIEW_REQUIRED",
      caseClientId: ENTITY.clientId,
      actor: ADMIN,
      command: {
        decision: "release",
        reason: "inspección física conforme",
        inspectionEvidenceIds: [evidence().evidenceId],
      },
      nowIso: "2026-08-10T12:30:00.000Z",
      currentChainHead: "head-1",
      releaseContext: { ...RELEASE_CTX, canonicalInspectionEvidenceIds: [evidence().evidenceId] },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state).toBe("RELEASED");
    // La decisión queda atada a una PERSONA y a su sesión, no al modelo.
    expect(out.record.actorUserId).toBe(ADMIN.userId);
    expect(out.record.actorSessionId).toBe(ADMIN.sessionId);
    expect(out.record.permission).toBe("wms.custody.decide");
  });

  it("sin permiso no se decide, por más que el análisis sea perfecto", () => {
    const out = applyHumanDecision({
      currentState: "REVIEW_REQUIRED",
      caseClientId: ENTITY.clientId,
      actor: { ...ADMIN, permissions: [] },
      command: {
        decision: "release",
        reason: "inspección física conforme",
        inspectionEvidenceIds: [evidence().evidenceId],
      },
      nowIso: "2026-08-10T12:30:00.000Z",
      currentChainHead: "head-1",
      releaseContext: { ...RELEASE_CTX, canonicalInspectionEvidenceIds: [evidence().evidenceId] },
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.rejection).toBe("PERMISSION_DENIED");
  });

  it("regresión de CUARENTENA: sigue siendo posible sin evidencia de inspección", () => {
    const out = applyHumanDecision({
      currentState: "REVIEW_REQUIRED",
      caseClientId: ENTITY.clientId,
      actor: { ...ADMIN, role: "operaciones" },
      command: {
        decision: "quarantine",
        reason: "diferencias visibles en la esquina",
        inspectionEvidenceIds: [],
      },
      nowIso: "2026-08-10T12:30:00.000Z",
      currentChainHead: "head-1",
      releaseContext: { ...RELEASE_CTX, canonicalInspectionEvidenceIds: [] },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state).toBe("QUARANTINED");
  });

  it("un caso de otro cliente no se decide ni con permiso", () => {
    const out = applyHumanDecision({
      currentState: "REVIEW_REQUIRED",
      caseClientId: "00000000-0000-4000-8000-000000000000",
      actor: ADMIN,
      command: { decision: "quarantine", reason: "motivo suficiente", inspectionEvidenceIds: [] },
      nowIso: "2026-08-10T12:30:00.000Z",
      currentChainHead: "head-1",
      releaseContext: { ...RELEASE_CTX, canonicalInspectionEvidenceIds: [] },
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.rejection).toBe("CLIENT_MISMATCH");
  });
});
