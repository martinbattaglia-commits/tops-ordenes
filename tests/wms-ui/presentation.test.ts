/**
 * WMS UI-1 · Modelo de presentación: RBAC, POD, IA informativa y no filtración.
 *
 * Son pruebas del comportamiento que la pantalla MUESTRA, sin render: el
 * view-model es puro y contiene todas las decisiones de habilitación, así que
 * se puede afirmar sobre él con la misma fuerza con la que se afirmaría sobre
 * el DOM —y sin fingir que hay DOM—.
 */
import { describe, expect, it } from "vitest";
import {
  buildCustodyCaseView,
  blockerLabel,
  holdLabel,
  leaksSensitiveData,
  QUARANTINE_ROLES,
  RELEASE_ROLES,
} from "@/lib/custody/case-presentation";
import { evaluateReleaseEligibility, MIN_REASON_LENGTH } from "@/lib/custody/integrity";
import type { IntegrityAssessment, IntegrityCase, VerifiedActor } from "@/lib/custody/integrity";

const CLIENT = "22222222-2222-4222-8222-222222222222";
const SHIPMENT = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);

const ASSESSMENT: IntegrityAssessment = {
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
};

function caseOf(over: Partial<IntegrityCase> = {}): IntegrityCase {
  const ev = {
    evidenceId: "33333333-3333-4333-8333-333333333333",
    eventId: "44444444-4444-4444-8444-444444444444",
    scope: "shipment" as const,
    entityId: SHIPMENT,
    clientId: CLIENT,
    stage: "packing" as const,
    eventType: "foto_packing" as const,
    kind: "foto" as const,
    sha256: SHA,
    capturedAt: "2026-08-08T10:15:00.000Z",
    redacted: false,
  };
  return {
    caseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version: 3,
    evaluationLease: null,
    entity: { scope: "shipment", entityId: SHIPMENT, clientId: CLIENT },
    selector: { ingressEvidenceId: ev.evidenceId, egressEvidenceId: "55555555-5555-4555-8555-555555555555" },
    state: "REVIEW_REQUIRED",
    holdReasons: ["NO_CALIBRATED_THRESHOLD"],
    evidence: { ingress: ev, egress: { ...ev, evidenceId: "55555555-5555-4555-8555-555555555555", stage: "entrega", eventType: "foto_entrega" } },
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
    assessment: ASSESSMENT,
    decision: null,
    createdAt: "2026-08-08T10:15:00.000Z",
    updatedAt: "2026-08-10T09:42:00.000Z",
    ...over,
  };
}

function actorOf(over: Partial<VerifiedActor> = {}): VerifiedActor {
  return {
    subjectType: "human_session",
    userId: "77777777-7777-4777-8777-777777777777",
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    clientId: CLIENT,
    role: "admin",
    permissions: ["wms.custody.decide"],
    ...over,
  };
}

const INSPECTION = ["66666666-6666-4666-8666-666666666666"];

describe("RBAC en la pantalla refleja la regla del servidor", () => {
  it("RELEASE es admin-only, tal como lo exige el CHECK de la fila de decisión", () => {
    expect(RELEASE_ROLES).toEqual(["admin"]);
    expect(QUARANTINE_ROLES).toEqual(["admin", "operaciones", "supervisor"]);
  });

  it("admin con motivo, evidencia e IA real ⇒ liberar habilitado", () => {
    const v = buildCustodyCaseView({
      case: caseOf(),
      actor: actorOf(),
      draftReason: "inspección física conforme",
      candidateInspectionEvidenceIds: INSPECTION,
    });
    expect(v.release.enabled).toBe(true);
    expect(v.release.blockers).toEqual([]);
  });

  it("operaciones NO puede liberar, y se dice por qué", () => {
    const v = buildCustodyCaseView({
      case: caseOf(),
      actor: actorOf({ role: "operaciones" }),
      draftReason: "inspección física conforme",
      candidateInspectionEvidenceIds: INSPECTION,
    });
    expect(v.release.enabled).toBe(false);
    expect(v.release.blockers).toContain("La liberación está reservada a Dirección (admin)");
    // pero sí puede cuarentenar
    expect(v.quarantine.enabled).toBe(true);
  });

  it("sin permiso no hay ninguna acción", () => {
    const v = buildCustodyCaseView({
      case: caseOf(),
      actor: actorOf({ permissions: [] }),
      draftReason: "inspección física conforme",
      candidateInspectionEvidenceIds: INSPECTION,
    });
    expect(v.release.enabled).toBe(false);
    expect(v.quarantine.enabled).toBe(false);
    expect(v.quarantine.blockers).toContain("No tenés permiso para decidir");
  });

  it("sin sesión verificada tampoco", () => {
    const v = buildCustodyCaseView({ case: caseOf(), actor: null, draftReason: "motivo suficiente" });
    expect(v.release.enabled).toBe(false);
    expect(v.quarantine.enabled).toBe(false);
    expect(v.quarantine.blockers).toContain("Sesión no verificada");
  });

  it("el MOTIVO no gobierna la habilitación server-side: lo hace el panel", () => {
    // El motivo es texto que se está tipeando en el navegador; el servidor no
    // lo ve hasta que se envía la decisión. Si participara de `enabled`, el
    // botón quedaría deshabilitado para siempre —el servidor siempre vería el
    // motivo vacío—. Acá se fija esa separación.
    const conMotivoCorto = buildCustodyCaseView({
      case: caseOf(),
      actor: actorOf(),
      draftReason: "corto",
      candidateInspectionEvidenceIds: INSPECTION,
    });
    expect(conMotivoCorto.release.enabled).toBe(true);
    expect(conMotivoCorto.quarantine.enabled).toBe(true);
    expect(conMotivoCorto.release.blockers).not.toContain(
      `El motivo debe tener al menos ${MIN_REASON_LENGTH} caracteres`,
    );

    // Sin ningún motivo, idéntico: la habilitación describe el CASO.
    const sinMotivo = buildCustodyCaseView({
      case: caseOf(),
      actor: actorOf(),
      candidateInspectionEvidenceIds: INSPECTION,
    });
    expect(sinMotivo.release.enabled).toBe(true);
    expect(sinMotivo.quarantine.enabled).toBe(true);
  });

  it("pero el motivo SÍ lo sigue exigiendo el dominio al decidir", () => {
    // La separación de arriba no relaja la regla: la decisión con motivo corto
    // se rechaza igual, y esta es la capa que de verdad la enforce.
    const eleg = evaluateReleaseEligibility({
      state: "REVIEW_REQUIRED",
      holdReasons: ["NO_CALIBRATED_THRESHOLD"],
      evidenceOk: true,
      chain: caseOf().chain,
      assessment: ASSESSMENT,
      canonicalInspectionEvidenceIds: INSPECTION,
      reason: "corto",
    });
    expect(eleg.allowed).toBe(false);
    expect(eleg.blockers).toContain("REASON_TOO_SHORT");
  });

  it("un caso ya decidido no vuelve a decidirse", () => {
    const v = buildCustodyCaseView({
      case: caseOf({
        state: "RELEASED",
        decision: {
          decision: "release",
          actorUserId: "u", actorSessionId: "s", actorRole: "admin", clientId: CLIENT,
          permission: "wms.custody.decide", decidedAt: "2026-08-10T12:00:00.000Z",
          reason: "conforme", observations: null, inspectionEvidenceIds: [],
          previousState: "REVIEW_REQUIRED", newState: "RELEASED", chainHeadAtDecision: "head-1",
        },
      }),
      actor: actorOf(),
      draftReason: "inspección física conforme",
      candidateInspectionEvidenceIds: INSPECTION,
    });
    expect(v.release.enabled).toBe(false);
    expect(v.quarantine.enabled).toBe(false);
    expect(v.decision?.label).toBe("Liberado para despacho");
  });
});

describe("POD bloqueado hasta la decisión humana", () => {
  it("en revisión ⇒ bloqueado con motivo", () => {
    const v = buildCustodyCaseView({ case: caseOf(), actor: actorOf() });
    expect(v.podBlocked).toBe(true);
    expect(v.podBlockedReason).toMatch(/bloquead/i);
  });

  it("en cuarentena ⇒ sigue bloqueado", () => {
    const v = buildCustodyCaseView({ case: caseOf({ state: "QUARANTINED" }), actor: actorOf() });
    expect(v.podBlocked).toBe(true);
  });

  it("liberado ⇒ recién ahí se habilita", () => {
    const v = buildCustodyCaseView({ case: caseOf({ state: "RELEASED" }), actor: actorOf() });
    expect(v.podBlocked).toBe(false);
    expect(v.podBlockedReason).toBeNull();
  });

  it("scope shipment liberado ⇒ la compuerta descarga contra la propia entidad", () => {
    const v = buildCustodyCaseView({ case: caseOf({ state: "RELEASED" }), actor: actorOf() });
    expect(v.podShipmentId).toBe(SHIPMENT);
  });
});

describe("FILA 11b · POD de la unidad física: estado real y motivo visible", () => {
  const UNIT = "99999999-9999-4999-8999-999999999999";
  const unitCase = () =>
    caseOf({ state: "RELEASED", entity: { scope: "physical_unit", entityId: UNIT, clientId: CLIENT } });

  it("liberada sin despacho resuelto ⇒ sin botón y CON motivo (no el literal genérico)", () => {
    const v = buildCustodyCaseView({ case: unitCase(), actor: actorOf() });
    expect(v.podBlocked).toBe(false);
    expect(v.podShipmentId).toBeNull();
    expect(v.podBlockedReason).toMatch(/no integra ningún despacho/i);
  });

  it("despacho sin entrega ⇒ el POD es post-entrega y el motivo nombra al despacho", () => {
    const v = buildCustodyCaseView({
      case: unitCase(),
      actor: actorOf(),
      physicalUnitPod: { shipmentId: SHIPMENT, shipmentPublicId: "DSP-2026-0001", delivered: false, podExists: false },
    });
    expect(v.podShipmentId).toBeNull();
    expect(v.podBlockedReason).toMatch(/post-entrega/i);
    expect(v.podBlockedReason).toContain("DSP-2026-0001");
  });

  it("entregado pero sin POD emitido ⇒ sin botón, con motivo que apunta al despacho", () => {
    const v = buildCustodyCaseView({
      case: unitCase(),
      actor: actorOf(),
      physicalUnitPod: { shipmentId: SHIPMENT, shipmentPublicId: "DSP-2026-0001", delivered: true, podExists: false },
    });
    expect(v.podShipmentId).toBeNull();
    expect(v.podBlockedReason).toMatch(/aún no fue emitido/i);
  });

  it("entregado con POD emitido ⇒ descarga contra el despacho resuelto y sin motivo", () => {
    const v = buildCustodyCaseView({
      case: unitCase(),
      actor: actorOf(),
      physicalUnitPod: { shipmentId: SHIPMENT, shipmentPublicId: "DSP-2026-0001", delivered: true, podExists: true },
      podPdfReady: true,
    });
    expect(v.podShipmentId).toBe(SHIPMENT);
    expect(v.podBlockedReason).toBeNull();
    expect(v.podPdfReady).toBe(true);
  });

  it("la unidad NUNCA ofrece POD antes de la decisión: bloqueado manda", () => {
    const v = buildCustodyCaseView({
      case: caseOf({ entity: { scope: "physical_unit", entityId: UNIT, clientId: CLIENT } }),
      actor: actorOf(),
      physicalUnitPod: { shipmentId: SHIPMENT, shipmentPublicId: "DSP-2026-0001", delivered: true, podExists: true },
    });
    expect(v.podBlocked).toBe(true);
  });
});

describe("la IA informa y nunca decide", () => {
  it("el panel es informativo y no habilita nada por sí mismo", () => {
    const v = buildCustodyCaseView({ case: caseOf(), actor: actorOf(), draftReason: "motivo suficiente" });
    expect(v.ai.informativeOnly).toBe(true);
    expect(v.ai.confidencePercent).toBe(87);
    // Sin evidencia de inspección, la confianza perfecta no habilita liberar.
    expect(v.release.enabled).toBe(false);
    expect(v.release.blockers).toContain("Falta la foto de inspección humana");
  });

  // ── I3 · REGLA DE BORRADO ────────────────────────────────────────────
  //
  // El umbral no se muestra en ninguna superficie. La garantía es
  // ESTRUCTURAL: el view-model no tiene forma de transportarlo, así que no
  // hay nada que un componente pueda renderizar aunque quisiera. Antes existía
  // `referenceThreshold` —código muerto que sólo no se veía porque el servidor
  // mandaba `null`— y `thresholdPercent`, que sí viajaba.

  it("el view-model NO transporta el umbral en ninguna forma", () => {
    const v = buildCustodyCaseView({ case: caseOf(), actor: actorOf() });
    expect(v).not.toHaveProperty("referenceThreshold");
    expect(v.ai).not.toHaveProperty("thresholdPercent");
    // Ni el valor, ni el rótulo, ni la expresión «X % ≥ Y %».
    const serializado = JSON.stringify(v);
    expect(serializado).not.toContain("90");
    expect(serializado.toLowerCase()).not.toContain("umbral");
    expect(serializado).not.toMatch(/≥/);
  });

  it("el umbral se LEE para derivar el veredicto cualitativo, y sólo eso sale", () => {
    // El porcentaje de umbral existe en el dominio —hace falta para derivar
    // esto— y NO llega a la pantalla.
    const v = buildCustodyCaseView({
      case: caseOf({
        assessment: {
          ...ASSESSMENT,
          thresholdResult: "ABOVE_OR_EQUAL",
          thresholdPercent: 90,
          similarityScore: 94.2,
        },
      }),
      actor: actorOf(),
    });
    expect(v.ai.concordance?.verdict).toBe("ALTA");
    expect(v.ai.concordance?.label).toBe("CONCORDANCIA ALTA");
    // La concordancia SÍ se muestra: es útil y el operario la entiende.
    expect(v.ai.similarityScore).toBe(94.2);
    // El umbral que la derivó, no.
    expect(JSON.stringify(v)).not.toContain("90");
  });

  it("por debajo del criterio el veredicto exige inspección física, sin decir cuánto midió", () => {
    const v = buildCustodyCaseView({
      case: caseOf({
        assessment: { ...ASSESSMENT, thresholdResult: "BELOW", thresholdPercent: 90 },
      }),
      actor: actorOf(),
    });
    expect(v.ai.concordance?.verdict).toBe("BAJA");
    expect(v.ai.concordance?.requirement).toMatch(/inspección física obligatoria/i);
    expect(JSON.stringify(v).toLowerCase()).not.toContain("umbral");
  });

  it("sin resultado de umbral el veredicto es NO CONCLUYENTE, no un falso positivo", () => {
    const v = buildCustodyCaseView({
      case: caseOf({ assessment: { ...ASSESSMENT, thresholdResult: null } }),
      actor: actorOf(),
    });
    expect(v.ai.concordance?.verdict).toBe("NO_CONCLUYENTE");
  });

  it("la retención por score NO nombra el umbral ni su valor", () => {
    // HN-2 · esta etiqueta decía «El score está por debajo del umbral del 90 %»
    // y se pintaba bajo «Retenciones registradas».
    const v = buildCustodyCaseView({
      case: caseOf({ holdReasons: ["BELOW_SIMILARITY_THRESHOLD"] }),
      actor: actorOf(),
    });
    expect(v.holdLabels).toEqual(["Requiere inspección física antes de decidir"]);
    expect(v.holdLabels.join(" ")).not.toMatch(/umbral|90/i);
  });

  it("un análisis fallido se muestra como estado, no como veredicto", () => {
    const v = buildCustodyCaseView({
      case: caseOf({ assessment: { ...ASSESSMENT, outcome: "timeout", verdict: null, modelConfidence: null } }),
      actor: actorOf(),
    });
    expect(v.ai.executed).toBe(false);
    expect(v.ai.failureLabel).toBe("El análisis no respondió a tiempo");
  });
});

describe("serialización segura", () => {
  it("el view-model no lleva bucket, path, digest, token ni URL de storage", () => {
    const v = buildCustodyCaseView({
      case: caseOf(),
      actor: actorOf(),
      draftReason: "inspección física conforme",
      candidateInspectionEvidenceIds: INSPECTION,
    });
    const s = JSON.stringify(v);
    expect(s).not.toContain(SHA);
    expect(s).not.toContain("custody-evidence");
    expect(s).not.toContain("storage");
    expect(leaksSensitiveData(v)).toBe(false);
  });

  it("el detector reconoce una fuga si alguna vez apareciera", () => {
    expect(leaksSensitiveData({ x: `bucket custody-pii` })).toBe(true);
    expect(leaksSensitiveData({ x: SHA })).toBe(true);
    expect(leaksSensitiveData({ x: "https://abc.supabase.co/storage/v1/object?token=zz" })).toBe(true);
  });

  it("los motivos de retención se muestran en lenguaje operativo, sin internals", () => {
    expect(holdLabel("CHAIN_INVALID")).toBe("La cadena de custodia no es válida");
    expect(holdLabel("LO_QUE_SEA")).toBe("Retención registrada por el servidor");
    expect(blockerLabel("NO_HUMAN_INSPECTION_EVIDENCE")).toBe("Falta la foto de inspección humana");
    // S2-6 · el respaldo dejó de ser mudo: un código con forma de código pero
    // desconocido se declara con el paso a seguir, y una entrada que no tiene
    // forma de código (ya es frase traducida) pasa intacta.
    expect(blockerLabel("CODIGO_NUEVO_DESCONOCIDO")).toBe(
      "El sistema bloqueó este paso por un motivo que la pantalla todavía no sabe explicar. Anotá el código y avisá a supervisión: CODIGO_NUEVO_DESCONOCIDO",
    );
    expect(blockerLabel("XX")).toBe("XX");
  });
});

// =========================================================================
// S1-5 · EL CASO EN HOLD TIENE QUE PODER RESOLVERSE
//
// Escenario central del contrato y, hasta ahora, el único sin salida: el
// view-model bloqueaba la cuarentena para todo estado distinto de
// `REVIEW_REQUIRED`, mientras la RPC acepta explícitamente decidir desde
// `HOLD` (`0250a:2096`). Un caso retenido no se podía liberar —por
// definición— y tampoco cuarentenar. No había ninguna acción posible.
// =========================================================================

describe("S1-5 · el caso retenido se puede cuarentenar", () => {
  it("en HOLD la cuarentena está habilitada, igual que la acepta la RPC", () => {
    const v = buildCustodyCaseView({
      case: caseOf({ state: "HOLD", holdReasons: ["VERDICT_POSSIBLE_DAMAGE"] }),
      actor: actorOf(),
    });
    expect(v.quarantine.enabled).toBe(true);
    expect(v.quarantine.blockers).toEqual([]);
  });

  it("en REVIEW_REQUIRED sigue habilitada: no se rompió lo que ya funcionaba", () => {
    const v = buildCustodyCaseView({ case: caseOf(), actor: actorOf() });
    expect(v.quarantine.enabled).toBe(true);
  });

  it("en PENDING_EVIDENCE NO se habilita, y dice por qué", () => {
    const v = buildCustodyCaseView({
      case: caseOf({ state: "PENDING_EVIDENCE" }),
      actor: actorOf(),
    });
    expect(v.quarantine.enabled).toBe(false);
    expect(v.quarantine.blockers).toContain("El caso todavía no está listo para decidir");
  });

  it("un caso ya decidido no admite otra decisión", () => {
    const v = buildCustodyCaseView({ case: caseOf({ state: "QUARANTINED" }), actor: actorOf() });
    expect(v.quarantine.enabled).toBe(false);
    expect(v.quarantine.blockers).toContain("El caso ya tiene una decisión registrada");
  });
});
