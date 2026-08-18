/**
 * WMS · Validación de Integridad de Custodia — suite determinista y adversarial.
 *
 * REVISIÓN 3. Además de los mutantes del C4 anterior, mata los del C4 final:
 * frontera de liberación sellada, comando validado en runtime, repositorio que
 * ya no es vía alternativa, snapshots inmutables, loader que devuelve otra cosa
 * que lo pedido, par (stage,eventType), evidencia de inspección, `outcome`
 * desconocido, atestación de cadena, reserva atómica y expected_version.
 *
 * 🔴 Ninguna prueba toca Supabase, la red ni OpenAI. Los puertos entran por
 * inyección y los datos son sintéticos. La única lectura de disco es el test de
 * contrato del SQL, rotulado CONTRACT/DESIGN TEST ONLY.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ATTESTATION_MAX_AGE_MINUTES,
  CUSTODY_DECISION_PERMISSION,
  HELD_OPERATIONS,
  INSPECTION_PAIRS,
  RELEASABLE_HOLD_SET,
  SANDBOX_NOTICE,
  applyHumanDecision,
  buildAssessment,
  buildEvaluationOutcome,
  outcomeDiagnostics,
  buildInspectionProof,
  canPerform,
  decideIntegrityCase,
  deriveIntegrityCaseState,
  evaluateCertificateEligibility,
  evaluateIntegrityCase,
  evaluateReleaseEligibility,
  MIN_OVERRIDE_REASON_LENGTH,
  formatModelConfidence,
  holdsOperations,
  isAttestationCurrent,
  isExactSet,
  isFlagEnabled,
  isSha256Hex,
  readFlags,
  resolveExecutionMode,
  validateDecisionCommand,
  validateEvidencePair,
  validateInspectionEvidence,
  verifyChainForCase,
  ProviderRegistry,
  caseBinding,
  type ActorAuthorizationPort,
  type ChainHeadPort,
  type ChainVerification,
  type CompareRequest,
  type CustodyEntityRef,
  type IntegrityVisionProvider,
  type RawProviderPayload,
  type DecisionCommand,
  type EvidenceLoaderPort,
  type EvidencePairSelector,
  type EvaluationOutcome,
  type EvidenceRecord,
  type HoldReason,
  type HumanDecisionRecord,
  type IntegrityAssessment,
  type ProviderDescriptor,
  type VerifiedActor,
} from "./custody/integrity";
import {
  DegradedIntegrityVisionProvider,
  InMemoryIntegrityCaseRepository,
  MockIntegrityVisionProvider,
  NotExecutedVisionProvider,
  ThrowingIntegrityVisionProvider,
} from "./custody/integrity/test-doubles";

// ---------------------------------------------------------------------------
// Datos sintéticos
// ---------------------------------------------------------------------------

const CLIENT = "client-alpha";
const OTHER_CLIENT = "client-beta";
const T0 = "2026-08-09T10:00:00.000Z";
const T1 = "2026-08-09T10:30:00.000Z";
const NOW = "2026-08-09T11:00:00.000Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const HEAD = "chainhead-0001";

const ENTITY: CustodyEntityRef = { scope: "physical_unit", entityId: "pu-0001", clientId: CLIENT };

function ev(over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: "ev-in",
    eventId: "evt-in",
    scope: "physical_unit",
    entityId: "pu-0001",
    clientId: CLIENT,
    stage: "packing",
    eventType: "foto_packing",
    sha256: SHA_A,
    capturedAt: T0,
    redacted: false,
    ...over,
  };
}

const INGRESS = ev();
const EGRESS = ev({
  evidenceId: "ev-out",
  eventId: "evt-out",
  stage: "entrega",
  eventType: "foto_entrega",
  sha256: SHA_B,
  capturedAt: T1,
});

const SELECTOR: EvidencePairSelector = { ingressEvidenceId: "ev-in", egressEvidenceId: "ev-out" };

const CHAIN_OK: ChainVerification = {
  status: "verified",
  attestation: {
    scope: "physical_unit",
    entityId: "pu-0001",
    chainHead: HEAD,
    eventsChecked: 4,
    verifiedEventIds: ["evt-in", "evt-out"],
    attestedAt: NOW,
  },
};

const BOUND = caseBinding("c1", CLIENT, "pu-0001");

/** Proveedor REGISTRADO por identidad de instancia (R3-2). */
const REGISTRY = new ProviderRegistry();
const REAL_PROVIDER = new MockIntegrityVisionProvider("coincide", "authorized-provider", "real");
REGISTRY.register(REAL_PROVIDER, {
  provider: "authorized-provider",
  model: "m",
  promptVersion: "custody-integrity/v2",
  executionMode: "real",
});
const REAL_DESCRIPTOR: ProviderDescriptor = REAL_PROVIDER.descriptor;

function realAssessment(over: Partial<IntegrityAssessment> = {}): IntegrityAssessment {
  const base = buildAssessment(
    REAL_PROVIDER,
    { outcome: "ok", verdict: "coincide", modelConfidence: 0.97 },
    NOW,
    NOW,
    REGISTRY
  );
  return { ...base, ...over };
}

const ACTOR: VerifiedActor = {
  subjectType: "human_session",
  userId: "user-1",
  sessionId: "sess-1",
  clientId: CLIENT,
  role: "supervisor",
  permissions: [CUSTODY_DECISION_PERMISSION],
};

function cmd(over: Partial<DecisionCommand> = {}): DecisionCommand {
  return {
    decision: "release",
    reason: "Inspección física realizada, sin daño observable.",
    inspectionEvidenceIds: ["ev-insp"],
    ...over,
  };
}

function record(over: Partial<HumanDecisionRecord> = {}): HumanDecisionRecord {
  return {
    decision: "quarantine",
    actorUserId: "user-1",
    actorSessionId: "sess-1",
    actorRole: "supervisor",
    clientId: CLIENT,
    permission: CUSTODY_DECISION_PERMISSION,
    decidedAt: NOW,
    reason: "motivo suficiente para auditar",
    observations: null,
    inspectionEvidenceIds: [],
    previousState: "REVIEW_REQUIRED",
    newState: "QUARANTINED",
    chainHeadAtDecision: HEAD,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Dobles de puertos
// ---------------------------------------------------------------------------

class FakeLoader implements EvidenceLoaderPort {
  constructor(
    private readonly pair: { ingress: EvidenceRecord | null; egress: EvidenceRecord | null } = {
      ingress: INGRESS,
      egress: EGRESS,
    },
    private readonly inspection: EvidenceRecord[] = [ev({ evidenceId: "ev-insp", eventId: "evt-insp" })]
  ) {}
  async loadPair() {
    return this.pair;
  }
  async loadInspectionEvidence() {
    return this.inspection;
  }
}

class FakeAuth implements ActorAuthorizationPort {
  constructor(private readonly actor: VerifiedActor | null = ACTOR) {}
  async resolveActor() {
    return this.actor;
  }
}

class FakeChainHead implements ChainHeadPort {
  constructor(private readonly head: string | null = HEAD) {}
  async currentChainHead() {
    return this.head;
  }
}

const chainPort = (over: Record<string, unknown> = {}) =>
  vi.fn().mockResolvedValue({
    valid: true,
    events_checked: 4,
    first_error: null,
    verified_event_ids: ["evt-in", "evt-out"],
    chain_head: HEAD,
    attested_at: NOW,
    scope: "physical_unit",
    entity_id: "pu-0001",
    ...over,
  });

function evalDeps(over: Partial<Parameters<typeof evaluateIntegrityCase>[0]> = {}) {
  return {
    repository: new InMemoryIntegrityCaseRepository(),
    evidenceLoader: new FakeLoader(),
    provider: new MockIntegrityVisionProvider("coincide"),
    verifyChain: chainPort(),
    now: () => NOW,
    ...over,
  };
}

function decideDeps(repo: InMemoryIntegrityCaseRepository, over: Record<string, unknown> = {}) {
  return {
    repository: repo,
    authorization: new FakeAuth(),
    evidenceLoader: new FakeLoader(),
    chainHead: new FakeChainHead(),
    now: () => NOW,
    ...over,
  } as Parameters<typeof decideIntegrityCase>[0];
}

const EVAL_INPUT = { caseId: "c1", entity: ENTITY, selector: SELECTOR, requesterClientId: CLIENT };

const RELEASE_CTX_OK = {
  holdReasons: ["NO_CALIBRATED_THRESHOLD"] as const,
  evidenceOk: true,
  chain: CHAIN_OK,
  assessment: realAssessment(),
  canonicalInspectionEvidenceIds: ["ev-insp"],
};

// ===========================================================================
// F-1 · Frontera de liberación sellada
// ===========================================================================

describe("F-1 · frontera de liberación", () => {
  const base = { state: "REVIEW_REQUIRED" as const, ...RELEASE_CTX_OK, reason: "motivo suficiente aquí" };

  it("el conjunto liberable es exactamente NO_CALIBRATED_THRESHOLD", () => {
    expect(RELEASABLE_HOLD_SET).toEqual(["NO_CALIBRATED_THRESHOLD"]);
    expect(evaluateReleaseEligibility(base)).toEqual({
      allowed: true,
      blockers: [],
      overrideReasons: [],
    });
  });

  it.each([
    [[], "lista vacía"],
    [["CHAIN_INVALID"], "motivo ausente"],
    [["NO_CALIBRATED_THRESHOLD", "NO_CALIBRATED_THRESHOLD"], "duplicado"],
    [["NO_CALIBRATED_THRESHOLD", "VERDICT_DIFFERENCES"], "motivo adicional"],
  ])("holdReasons %j (%s) bloquea", (holds) => {
    const r = evaluateReleaseEligibility({ ...base, holdReasons: holds as never });
    expect(r.allowed).toBe(false);
    expect(r.blockers).toContain("HOLD_SET_NOT_EXACT");
  });

  it.each([[null], [undefined], ["NO_CALIBRATED_THRESHOLD"], [{}], [42]])(
    "holdReasons malformado %p bloquea",
    (bad) => {
      expect(isExactSet(bad, RELEASABLE_HOLD_SET)).toBe(false);
      const r = evaluateReleaseEligibility({ ...base, holdReasons: bad as never });
      expect(r.blockers).toContain("HOLD_SET_NOT_EXACT");
    }
  );

  it.each([
    [{ decision: "aprobar" }, "DECISION_UNKNOWN"],
    [{ decision: undefined }, "DECISION_UNKNOWN"],
    [{ reason: 42 }, "REASON_NOT_STRING"],
    [{ reason: "corto" }, "REASON_TOO_SHORT"],
    [{ inspectionEvidenceIds: "ev-1" }, "INSPECTION_IDS_NOT_ARRAY"],
    [{ inspectionEvidenceIds: ["", "x"] }, "INSPECTION_IDS_MALFORMED"],
    [{ inspectionEvidenceIds: ["a", "a"] }, "INSPECTION_IDS_MALFORMED"],
    [{ observations: 7 }, "OBSERVATIONS_NOT_STRING"],
  ])("comando inválido %j → %s", (over, problem) => {
    const r = validateDecisionCommand({ ...cmd(), ...over });
    expect(r.ok).toBe(false);
    expect(r.problems).toContain(problem);
  });

  it("una decisión desconocida NUNCA se degrada a quarantine", () => {
    const r = applyHumanDecision({
      currentState: "REVIEW_REQUIRED",
      caseClientId: CLIENT,
      actor: ACTOR,
      command: { ...cmd(), decision: "aprobar" as never },
      nowIso: NOW,
      currentChainHead: HEAD,
      releaseContext: RELEASE_CTX_OK,
    });
    expect(r).toEqual({ ok: false, rejection: "COMMAND_INVALID" });
  });
});

// ===========================================================================
// F-1.3 · El repositorio no es una vía alternativa
// ===========================================================================

// ===========================================================================
// F-1.2 · R-5 · El umbral de 90 bloquea TAMBIÉN en HOLD
//
// El caso por debajo del umbral no queda en REVIEW_REQUIRED: la DB lo deja en
// HOLD con `BELOW_SIMILARITY_THRESHOLD`. Como el chequeo de score vivía dentro
// de `state === "REVIEW_REQUIRED"`, ese caso devolvía `blockers: []` —botón
// habilitado, sin ninguna señal de que liberar ahí es un override—. La base
// igual exige admin y motivo reforzado, así que no era escalada de privilegio;
// era el control que justifica la feature sin bloquear en la capa que lo
// muestra.
// ===========================================================================

describe("F-1.2 · el umbral productivo bloquea en cualquier estado decidible", () => {
  const productivo = (over: Record<string, unknown> = {}) => ({
    ...realAssessment(),
    similarityScore: 84.25,
    thresholdPercent: 90,
    thresholdResult: "BELOW" as const,
    packagingChanged: false,
    missingItemsSuspected: false,
    damageSuspected: false,
    ...over,
  });

  const ctxHold = (over: Record<string, unknown> = {}) => ({
    state: "HOLD" as const,
    ...RELEASE_CTX_OK,
    holdReasons: ["BELOW_SIMILARITY_THRESHOLD"] as never,
    assessment: productivo(),
    reason: "motivo reforzado de override con longitud suficiente",
    ...over,
  });

  it("bajo el umbral en REVIEW_REQUIRED la liberación limpia está bloqueada", () => {
    // Rama estricta, la misma que exige la RPC en 0250a:2079-2087.
    const r = evaluateReleaseEligibility({ ...ctxHold(), state: "REVIEW_REQUIRED" });
    expect(r.allowed).toBe(false);
    expect(r.blockers).toContain("SCORE_BELOW_THRESHOLD");
  });

  it("en HOLD la liberación es posible pero queda DECLARADA como override", () => {
    // El inspector tiene que poder liberar bajo el umbral: si no pudiera, sería
    // la IA la que decide por omisión, que es exactamente lo que el contrato
    // prohíbe. Lo que no puede es que el override sea indistinguible de una
    // liberación limpia.
    const r = evaluateReleaseEligibility(ctxHold());
    expect(r.allowed).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.overrideReasons).toContain("SCORE_BELOW_THRESHOLD");

    // Y en REVIEW_REQUIRED con score suficiente no hay override: no es ruido fijo.
    const limpio = evaluateReleaseEligibility({
      state: "REVIEW_REQUIRED",
      ...RELEASE_CTX_OK,
      assessment: productivo({ similarityScore: 96, thresholdResult: "ABOVE_OR_EQUAL" }),
      reason: "motivo suficiente aquí",
    });
    expect(limpio.allowed).toBe(true);
    expect(limpio.overrideReasons).toEqual([]);
  });

  it("las banderas de daño también se declaran al liberar desde HOLD", () => {
    // El estado se construye como la BASE lo produce: 0250a declara
    // incompatibles `coincide` y cualquier bandera de daño, así que un caso con
    // daño llega SIEMPRE con veredicto distinto de `coincide`. La versión
    // anterior de este caso combinaba ambos y afirmaba sobre un estado que la
    // base no puede emitir.
    const r = evaluateReleaseEligibility(
      ctxHold({ assessment: productivo({ damageSuspected: true, verdict: "posible_dano" }) }),
    );
    expect(r.overrideReasons).toContain("DAMAGE_FLAGS_PRESENT");
  });

  it("el veredicto NO coincidente se declara como override, no bloquea", () => {
    // Sin este caso, revertir el arreglo de F-1 —volver `VERDICT_NOT_MATCHING` a
    // bloqueo duro— pasaba en verde: ningún otro caso usa un veredicto distinto
    // de `coincide`. Y con el bloqueo duro, toda unidad que la IA marca queda
    // inliberable, o sea que la IA decide la cuarentena por omisión.
    const r = evaluateReleaseEligibility(
      ctxHold({ assessment: productivo({ verdict: "diferencias" }) }),
    );
    expect(r.allowed).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.overrideReasons).toContain("VERDICT_NOT_MATCHING");
  });

  it("fuera del override, el veredicto NO coincidente sigue bloqueando", () => {
    // La rama estricta y la legada conservan la exigencia intacta.
    const enRevision = evaluateReleaseEligibility({
      ...ctxHold(),
      state: "REVIEW_REQUIRED",
      assessment: productivo({ verdict: "diferencias" }),
    });
    expect(enRevision.blockers).toContain("VERDICT_NOT_MATCHING");

    const legado = evaluateReleaseEligibility({
      state: "REVIEW_REQUIRED",
      ...RELEASE_CTX_OK,
      assessment: realAssessment({ verdict: "diferencias" }),
      reason: "motivo suficiente aquí",
    });
    expect(legado.allowed).toBe(false);
    expect(legado.blockers).toContain("VERDICT_NOT_MATCHING");
  });

  it("el motivo mínimo del override iguala el que exige la RPC: 20", () => {
    // 19 caracteres: la UI lo aceptaba y la RPC lo rechazaba con un error crudo.
    const corto = evaluateReleaseEligibility(ctxHold({ reason: "diecinueve caracte" }));
    expect(corto.blockers).toContain("REASON_TOO_SHORT");
    expect(MIN_OVERRIDE_REASON_LENGTH).toBe(20);
    // Y una liberación limpia conserva su piso de 10: el refuerzo es del override.
    expect(evaluateReleaseEligibility({
      state: "REVIEW_REQUIRED",
      ...RELEASE_CTX_OK,
      reason: "diez chars",
    }).blockers).not.toContain("REASON_TOO_SHORT");
  });
});

describe("F-1.3 · repositorio", () => {
  async function seeded() {
    const repo = new InMemoryIntegrityCaseRepository();
    await evaluateIntegrityCase(evalDeps({ repository: repo }), EVAL_INPUT);
    const c = await repo.findById("c1", CLIENT);
    return { repo, version: c?.version ?? 1 };
  }

  it("rechaza un RELEASED fabricado por llamada directa", async () => {
    const { repo, version } = await seeded();
    const r = await repo.applyDecision({
      caseId: "c1",
      clientId: CLIENT,
      expectedVersion: version,
      expectedState: "REVIEW_REQUIRED",
      newState: "RELEASED",
      updatedAt: NOW,
      currentChainHead: HEAD,
      record: record({ decision: "release", newState: "RELEASED", inspectionEvidenceIds: ["ev-insp"] }),
      inspectionProof: buildInspectionProof("c1", ENTITY, ["ev-insp"], [ev({ evidenceId: "ev-insp", eventId: "evt-insp" })], []),
      boundTo: BOUND,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["ATTESTATION_STALE", "RELEASE_NOT_ELIGIBLE", "INSPECTION_PROOF_INVALID"]).toContain(r.failure);
  });

  // HN-1 · §13.7 · la regla vive en el MODELO: un caso no físico no admite
  // decisión humana aunque el adaptador que lo sirva no la rechace. Si alguien
  // borra la guarda del repositorio y deja sólo la de la puerta de Supabase,
  // este test se pone en rojo.
  it.each([["packing_unit"], ["shipment"]] as const)(
    "un caso %s se rechaza en el repositorio con SCOPE_NOT_DECIDABLE",
    async (scope) => {
      const repo = new InMemoryIntegrityCaseRepository();
      const entity = { scope, entityId: "np-0001", clientId: CLIENT } as CustodyEntityRef;
      await repo.reserveCase({
        caseId: "c-np",
        entity,
        selector: { ingressEvidenceId: "ev-in", egressEvidenceId: "ev-out" },
        holder: "t",
        leaseUntil: NOW,
        createdAt: NOW,
      });
      const r = await repo.applyDecision({
        caseId: "c-np",
        clientId: CLIENT,
        expectedVersion: 1,
        // La guarda de scope corta ANTES del chequeo de estado: el caso recién
        // reservado está en PENDING_EVIDENCE y aun así el fallo es de scope.
        expectedState: "REVIEW_REQUIRED",
        newState: "QUARANTINED",
        updatedAt: NOW,
        currentChainHead: HEAD,
        record: record(),
        inspectionProof: buildInspectionProof("c-np", entity, [], [], []),
        boundTo: BOUND,
      });
      expect(r).toEqual({ ok: false, failure: "SCOPE_NOT_DECIDABLE" });
    },
  );

  it.each([
    [{ permission: "admin.todo" }],
    [{ clientId: OTHER_CLIENT }],
    [{ previousState: "PENDING_EVIDENCE" as const }],
    [{ decision: "release" as const }],
    [{ actorUserId: "" }],
    [{ actorSessionId: "  " }],
    [{ actorRole: "" }],
    [{ decidedAt: "no-es-fecha" }],
    [{ reason: "x" }],
  ])("rechaza record incoherente %j", async (over) => {
    const { repo, version } = await seeded();
    const r = await repo.applyDecision({
      caseId: "c1",
      clientId: CLIENT,
      expectedVersion: version,
      expectedState: "REVIEW_REQUIRED",
      newState: "QUARANTINED",
      updatedAt: NOW,
      currentChainHead: HEAD,
      record: record(over as Partial<HumanDecisionRecord>),
      inspectionProof: buildInspectionProof("c1", ENTITY, [], [], []),
      boundTo: BOUND,
    });
    expect(r).toEqual({ ok: false, failure: "RECORD_INCOHERENT" });
  });

  it.each([[null], [undefined], [0], [-1], [1.5], [NaN]])(
    "expectedVersion=%p es rechazado",
    async (bad) => {
      const { repo } = await seeded();
      const r = await repo.applyDecision({
        caseId: "c1",
        clientId: CLIENT,
        expectedVersion: bad as never,
        expectedState: "REVIEW_REQUIRED",
        newState: "QUARANTINED",
        updatedAt: NOW,
        currentChainHead: HEAD,
        record: record(),
        inspectionProof: buildInspectionProof("c1", ENTITY, [], [], []),
        boundTo: BOUND,
      });
      expect(r).toEqual({ ok: false, failure: "VERSION_CONFLICT" });
    }
  );

  it("mutar el objeto devuelto NO modifica el caso persistido", async () => {
    const { repo } = await seeded();
    const snapshot = await repo.findById("c1", CLIENT);
    expect(snapshot).not.toBeNull();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => {
      (snapshot as unknown as { state: string }).state = "RELEASED";
    }).toThrow();
    const again = await repo.findById("c1", CLIENT);
    expect(again?.state).toBe("REVIEW_REQUIRED");
  });

  it("mutar arrays anidados del snapshot no contamina el almacenamiento", async () => {
    const { repo } = await seeded();
    const snapshot = await repo.findById("c1", CLIENT);
    try {
      snapshot?.holdReasons.push("CHAIN_INVALID");
    } catch {
      /* congelado: también aceptable */
    }
    const again = await repo.findById("c1", CLIENT);
    expect(again?.holdReasons).not.toContain("CHAIN_INVALID");
  });

  it("recordAssessment no puede escribir un estado terminal ni con cast", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    await repo.reserveCase({ caseId: "cx", entity: ENTITY, selector: SELECTOR, createdAt: NOW, holder: "t", leaseUntil: "2026-08-09T11:05:00.000Z" });
    // El caller ya no tiene campo `state`: sólo puede pasar un outcome. Uno
    // fabricado (no canónico) se rechaza antes de mirar nada más.
    const r = await repo.recordAssessment({
      caseId: "cx",
      clientId: CLIENT,
      expectedVersion: 1,
      updatedAt: NOW,
      boundTo: caseBinding("cx", CLIENT, "pu-0001"),
      outcome: {
        entity: ENTITY, selector: SELECTOR,
        evidence: { ingress: INGRESS, egress: EGRESS },
        chain: CHAIN_OK, assessment: realAssessment(),
        state: "RELEASED" as never, holdReasons: [], evaluatedAt: NOW,
      },
    });
    expect(r).toEqual({ ok: false, failure: "ARTIFACT_NOT_CANONICAL" });
  });
});

// ===========================================================================
// F-2 · Evidencia y proveedor
// ===========================================================================

describe("F-2 · evidencia", () => {
  it("un loader que devuelve C/D para un selector A/B es rechazado", () => {
    const other = ev({ evidenceId: "ev-OTRA", eventId: "evt-OTRA", stage: "entrega", eventType: "foto_entrega", sha256: SHA_B, capturedAt: T1 });
    const v = validateEvidencePair({ ingress: INGRESS, egress: other }, ENTITY, NOW, undefined, SELECTOR);
    expect(v.problems).toContain("EVIDENCE_ID_MISMATCH");
  });

  it("stage incorrecto con eventType aparentemente correcto es rechazado", () => {
    const bad = ev({ evidenceId: "ev-out", eventId: "evt-out", stage: "packing", eventType: "foto_entrega", sha256: SHA_B, capturedAt: T1 });
    const v = validateEvidencePair({ ingress: INGRESS, egress: bad }, ENTITY, NOW, undefined, SELECTOR);
    expect(v.problems).toContain("EVIDENCE_WRONG_STAGE");
  });

  it("acepta el par válido", () => {
    expect(validateEvidencePair({ ingress: INGRESS, egress: EGRESS }, ENTITY, NOW, undefined, SELECTOR)).toEqual({
      ok: true, problems: [], eventIds: ["evt-in", "evt-out"],
    });
  });

  it("SHA con distinto case es el mismo binario", () => {
    const upper = ev({ evidenceId: "ev-out", eventId: "evt-out", stage: "entrega", eventType: "foto_entrega", sha256: SHA_A.toUpperCase(), capturedAt: T1 });
    expect(validateEvidencePair({ ingress: INGRESS, egress: upper }, ENTITY, NOW).problems).toContain("EVIDENCE_SAME_IMAGE");
  });

  it.each([["zz".repeat(32)], ["abc"], [""], [SHA_A + "0"]])("digest inválido es rechazado", (bad) => {
    expect(validateEvidencePair({ ingress: INGRESS, egress: { ...EGRESS, sha256: bad } }, ENTITY, NOW).problems).toContain("EVIDENCE_MALFORMED_DIGEST");
    expect(isSha256Hex(bad)).toBe(false);
  });

  it("timestamps inválidos, futuros y desordenados son rechazados", () => {
    expect(validateEvidencePair({ ingress: INGRESS, egress: { ...EGRESS, capturedAt: "ayer" } }, ENTITY, NOW).problems).toContain("EVIDENCE_MALFORMED_TIMESTAMP");
    expect(validateEvidencePair({ ingress: INGRESS, egress: { ...EGRESS, capturedAt: "2027-01-01T00:00:00.000Z" } }, ENTITY, NOW).problems).toContain("EVIDENCE_FUTURE");
    expect(validateEvidencePair({ ingress: INGRESS, egress: { ...EGRESS, capturedAt: "2026-08-09T09:00:00.000Z" } }, ENTITY, NOW).problems).toContain("EVIDENCE_OUT_OF_ORDER");
  });

  it.each([[Infinity], [NaN], [-5], [0], [999999]])("maxAge=%p cae al default y retiene", (bad) => {
    expect(validateEvidencePair({ ingress: INGRESS, egress: EGRESS }, ENTITY, "2026-08-10T23:00:00.000Z", bad).problems).toContain("EVIDENCE_STALE");
  });

  it("rechaza evidencia de otro cliente, otra unidad y redactada", () => {
    expect(validateEvidencePair({ ingress: INGRESS, egress: { ...EGRESS, clientId: OTHER_CLIENT } }, ENTITY, NOW).problems).toContain("EVIDENCE_FOREIGN_CLIENT");
    expect(validateEvidencePair({ ingress: INGRESS, egress: { ...EGRESS, entityId: "pu-9" } }, ENTITY, NOW).problems).toContain("EVIDENCE_FOREIGN_ENTITY");
    expect(validateEvidencePair({ ingress: INGRESS, egress: { ...EGRESS, redacted: true } }, ENTITY, NOW).problems).toContain("EVIDENCE_REDACTED");
  });
});

describe("F-2.3 · evidencia de inspección — D1 aplicada", () => {
  it("el esquema representa la inspección humana con UN par y sólo uno", () => {
    // Antes esta lista estaba vacía y la liberación quedaba bloqueada por
    // diseño. 0221 agregó `inspeccion_humana` al enum y Dirección autorizó
    // reconocer exactamente `(despacho, inspeccion_humana)`: ni un par más.
    expect(INSPECTION_PAIRS).toEqual([["despacho", "inspeccion_humana"]]);
  });

  it("cualquier evidencia de inspección se rechaza mientras el esquema no la represente", () => {
    const insp = ev({ evidenceId: "ev-insp", eventId: "evt-insp" });
    const r = validateInspectionEvidence(["ev-insp"], [insp], ENTITY, ["ev-in", "ev-out"]);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain("INSPECTION_NOT_REPRESENTABLE_IN_SCHEMA");
    expect(r.evidenceIds).toEqual([]);
  });

  it("en consecuencia, la liberación end-to-end queda bloqueada", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    await evaluateIntegrityCase(evalDeps({ repository: repo }), EVAL_INPUT);
    const r = await decideIntegrityCase(decideDeps(repo), "c1", cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("RELEASE_NOT_ELIGIBLE");
      expect(r.blockers).toContain("NO_HUMAN_INSPECTION_EVIDENCE");
    }
  });
});

describe("F-2.4/5 · proveedor", () => {
  it.each([["aprobado"], [undefined], [null], [42], [{}]])(
    "outcome desconocido %p → invalid_response y hold",
    (bad) => {
      const a = buildAssessment(REAL_PROVIDER, { outcome: bad } as never, NOW, NOW, REGISTRY);
      expect(a.outcome).toBe("invalid_response");
      const d = deriveIntegrityCaseState({
        evidence: { ok: true, problems: [], eventIds: ["evt-in"] },
        chain: CHAIN_OK,
        assessment: a,
      });
      expect(d.reasons).toContain("PROVIDER_INVALID_RESPONSE");
    }
  );

  it("R3-2 · un impostor con el MISMO nombre que un proveedor permitido queda mock", () => {
    // Misma etiqueta, otra instancia: no está registrada.
    const impostor = new MockIntegrityVisionProvider("coincide", "authorized-provider", "real");
    expect(impostor.descriptor.name).toBe(REAL_PROVIDER.descriptor.name);
    expect(resolveExecutionMode(impostor, REGISTRY)).toBe("mock");
    expect(resolveExecutionMode(REAL_PROVIDER, REGISTRY)).toBe("real");
    const a = buildAssessment(impostor, { outcome: "ok", verdict: "coincide", modelConfidence: 0.9 }, NOW, NOW, REGISTRY);
    expect(a.provenance.executionMode).toBe("mock");
  });

  it("descriptor malformado se sanea, no se propaga", () => {
    const junk = { descriptor: { name: 42, model: null, promptVersion: undefined, declaredMode: "super" } } as unknown as MockIntegrityVisionProvider;
    const a = buildAssessment(junk, { outcome: "ok", verdict: "coincide", modelConfidence: 0.5 }, NOW, NOW, REGISTRY);
    expect(a.provenance.provider).toBe("unknown");
    expect(a.provenance.executionMode).toBe("mock");
  });

  it("observations/zones/error se acotan y sanean", () => {
    const a = buildAssessment(
      REAL_PROVIDER,
      { outcome: "ok", verdict: "coincide", modelConfidence: 0.5, observations: new Array(50).fill("x".repeat(1000)), zones: "no-es-array", error: 42 },
      NOW, NOW, REGISTRY
    );
    expect(a.observations.length).toBeLessThanOrEqual(6);
    expect(a.observations[0].length).toBeLessThanOrEqual(240);
    expect(a.zones).toEqual([]);
    expect(a.error).toBeNull();
  });

  it.each([[undefined], [null], ["nope"], [NaN], [Infinity], [2], [-0.5]])(
    "modelConfidence=%p invalida el resultado",
    (bad) => {
      const a = buildAssessment(REAL_PROVIDER, { outcome: "ok", verdict: "coincide", modelConfidence: bad }, NOW, NOW, REGISTRY);
      expect(a.outcome).toBe("invalid_response");
      expect(a.verdict).toBeNull();
    }
  );

  it("el proveedor por defecto no ejecuta", async () => {
    const raw = await new NotExecutedVisionProvider().compare({ ingress: INGRESS, egress: EGRESS, requestedAt: NOW });
    expect(raw.outcome).toBe("not_executed");
    expect(raw.error).toBe("EXTERNAL AI CALL NOT AUTHORIZED");
  });
});

// ===========================================================================
// F-3 · Atestación de cadena y certificado
// ===========================================================================

describe("F-3 · atestación de cadena", () => {
  const req = { scope: "physical_unit" as const, entityId: "pu-0001", requiredEventIds: ["evt-in", "evt-out"], verifiedAtIso: NOW };

  it("el camino verified exige la atestación completa", async () => {
    const r = await verifyChainForCase(chainPort(), req);
    expect(r.status).toBe("verified");
    if (r.status === "verified") {
      expect(r.attestation.chainHead).toBe(HEAD);
      expect(r.attestation.attestedAt).toBe(NOW);
      expect(r.attestation.eventsChecked).toBe(4);
    }
  });

  it.each([0, -1, 2.5, NaN, Infinity, -Infinity])("events_checked=%p NO es verified", async (n) => {
    const r = await verifyChainForCase(chainPort({ events_checked: n }), req);
    expect(r.status).toBe("unverifiable");
  });

  it.each([
    [{ chain_head: null }, /chain_head/],
    [{ chain_head: "  " }, /chain_head/],
    [{ attested_at: null }, /attested_at/],
    [{ attested_at: "no-es-fecha" }, /attested_at/],
    [{ verified_event_ids: undefined }, /vinculaci/i],
    [{ verified_event_ids: ["otro"] }, /no vinculadas/],
    [{ entity_id: "pu-OTRA" }, /no corresponde/],
    [{ scope: "shipment" }, /no corresponde/],
  ])("atestación incompleta %j → unverifiable", async (over, re) => {
    const r = await verifyChainForCase(chainPort(over), req);
    expect(r.status).toBe("unverifiable");
    if (r.status === "unverifiable") expect(r.error).toMatch(re);
  });

  it("throw y payload malformado son unverifiable", async () => {
    expect((await verifyChainForCase(vi.fn().mockRejectedValue(new Error("x")), req)).status).toBe("unverifiable");
    expect((await verifyChainForCase(vi.fn().mockResolvedValue({ nope: 1 }), req)).status).toBe("unverifiable");
  });

  it("una atestación con head cambiado o vencida ya no es vigente", () => {
    const att = CHAIN_OK.status === "verified" ? CHAIN_OK.attestation : null;
    expect(att).not.toBeNull();
    if (!att) return;
    expect(isAttestationCurrent(att, HEAD, NOW)).toBe(true);
    expect(isAttestationCurrent(att, "otro-head", NOW)).toBe(false);
    expect(isAttestationCurrent(att, null, NOW)).toBe(false);
    const later = new Date(Date.parse(NOW) + (ATTESTATION_MAX_AGE_MINUTES + 1) * 60_000).toISOString();
    expect(isAttestationCurrent(att, HEAD, later)).toBe(false);
  });
});

describe("F-3.5 · certificado", () => {
  const decision: HumanDecisionRecord = record({
    decision: "release",
    newState: "RELEASED",
    inspectionEvidenceIds: ["ev-insp"],
  });
  const base = {
    state: "RELEASED" as const,
    caseClientId: CLIENT,
    requesterClientId: CLIENT,
    evidenceOk: true,
    evidenceEventIds: ["evt-in", "evt-out"],
    chain: CHAIN_OK,
    assessment: realAssessment(),
    decision,
    canonicalInspectionEvidenceIds: ["ev-insp"],
    currentChainHead: HEAD,
    issuedAt: NOW,
  };

  it("certifica sólo con todo cumplido", () => {
    expect(evaluateCertificateEligibility(base)).toEqual({ document: "certificate", blockers: [] });
  });

  it.each([["diferencias"], ["posible_dano"], [null]] as const)("verdict %s → acta", (verdict) => {
    const r = evaluateCertificateEligibility({ ...base, assessment: realAssessment({ verdict }) });
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toContain("VERDICT_NOT_MATCHING");
  });

  it.each([
    [{ decision: { ...decision, permission: "otro" } }, "DECISION_PERMISSION_INVALID"],
    [{ decision: { ...decision, previousState: "PENDING_EVIDENCE" as const } }, "DECISION_STATE_INCOHERENT"],
    [{ decision: { ...decision, actorSessionId: "" } }, "DECISION_ACTOR_INVALID"],
    [{ decision: { ...decision, decidedAt: "nope" } }, "DECISION_TIMESTAMP_INVALID"],
    [{ decision: { ...decision, reason: "x" } }, "DECISION_REASON_TOO_SHORT"],
    [{ decision: { ...decision, clientId: OTHER_CLIENT } }, "DECISION_CLIENT_MISMATCH"],
    [{ decision: { ...decision, inspectionEvidenceIds: [] } }, "NO_INSPECTION_EVIDENCE"],
    // V4-bis: la punta viva ya no participa; lo vencido se mide al DECIDIR.
    [
      { decision: { ...decision, decidedAt: "2026-08-09T13:01:00.000Z" } },
      "CHAIN_ATTESTATION_STALE",
    ],
    [{ evidenceEventIds: ["desconocido"] }, "EVIDENCE_NOT_LINKED"],
  ])("bloqueo %#", (over, blocker) => {
    const r = evaluateCertificateEligibility({ ...base, ...(over as object) });
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toContain(blocker);
  });

  it("la leyenda de sandbox y la etiqueta de confianza son explícitas", () => {
    expect(SANDBOX_NOTICE).toBe("SANDBOX · DATOS SINTÉTICOS · SIN VALOR PROBATORIO");
    expect(formatModelConfidence(0.97)).not.toMatch(/nivel de coincidencia/i);
    for (const bad of [null, NaN as unknown as number, Infinity, 2]) {
      expect(formatModelConfidence(bad)).toContain("no disponible");
    }
  });
});

// ===========================================================================
// F-4 · Concurrencia de la primera evaluación
// ===========================================================================

describe("F-4 · primera evaluación concurrente", () => {
  it("dos evaluaciones concurrentes: el proveedor se invoca UNA sola vez", async () => {
    const provider = new MockIntegrityVisionProvider("coincide");
    const spy = vi.spyOn(provider, "compare");
    const deps = evalDeps({ provider });
    const [a, b] = await Promise.all([
      evaluateIntegrityCase(deps, EVAL_INPUT),
      evaluateIntegrityCase(deps, EVAL_INPUT),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    const winners = [a, b].filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    const loser = [a, b].find((r) => !r.ok);
    expect(loser && !loser.ok && loser.error).toMatch(/EVALUATION_IN_PROGRESS|CASE_ALREADY_EVALUATED/);
  });

  it("no lanza excepción sin tipar por caso duplicado", async () => {
    const deps = evalDeps();
    await expect(
      Promise.all([evaluateIntegrityCase(deps, EVAL_INPUT), evaluateIntegrityCase(deps, EVAL_INPUT)])
    ).resolves.toBeDefined();
  });

  it("una reevaluación posterior recibe conflicto tipado", async () => {
    const deps = evalDeps();
    await evaluateIntegrityCase(deps, EVAL_INPUT);
    const again = await evaluateIntegrityCase(deps, EVAL_INPUT);
    expect(again).toEqual({ ok: false, error: "CASE_ALREADY_EVALUATED" });
  });
});

// ===========================================================================
// Caso de uso · identidad, no-invocación, persistencia del hold
// ===========================================================================

describe("caso de uso", () => {
  it("no invoca al proveedor con evidencia inválida", async () => {
    const provider = new MockIntegrityVisionProvider("coincide");
    const spy = vi.spyOn(provider, "compare");
    const r = await evaluateIntegrityCase(
      evalDeps({ provider, evidenceLoader: new FakeLoader({ ingress: INGRESS, egress: { ...EGRESS, redacted: true } }) }),
      EVAL_INPUT
    );
    expect(spy).not.toHaveBeenCalled();
    expect(r.ok && r.case.holdReasons).toContain("EVIDENCE_REDACTED");
  });

  it("un proveedor que lanza persiste la retención", async () => {
    const r = await evaluateIntegrityCase(evalDeps({ provider: new ThrowingIntegrityVisionProvider("boom") }), EVAL_INPUT);
    expect(r.ok && r.case.holdReasons).toContain("PROVIDER_THREW");
  });

  it.each([["timeout", "PROVIDER_TIMEOUT"], ["unavailable", "PROVIDER_UNAVAILABLE"]] as const)(
    "proveedor %s retiene",
    async (outcome, reason) => {
      const r = await evaluateIntegrityCase(evalDeps({ provider: new DegradedIntegrityVisionProvider(outcome, "x") }), EVAL_INPUT);
      expect(r.ok && r.case.holdReasons).toContain(reason);
    }
  );

  it("rechaza evaluación de otro cliente", async () => {
    expect(await evaluateIntegrityCase(evalDeps(), { ...EVAL_INPUT, requesterClientId: OTHER_CLIENT })).toEqual({
      ok: false, error: "CLIENT_MISMATCH",
    });
  });

  it("caseId reutilizado con otra entidad o par → conflicto sin invocar proveedor", async () => {
    const deps = evalDeps();
    await evaluateIntegrityCase(deps, EVAL_INPUT);
    const spy = vi.spyOn(deps.provider, "compare");
    expect(await evaluateIntegrityCase(deps, { ...EVAL_INPUT, entity: { ...ENTITY, entityId: "pu-OTRA" } })).toEqual({
      ok: false, error: "CASE_IDENTITY_MISMATCH",
    });
    expect(await evaluateIntegrityCase(deps, { ...EVAL_INPUT, selector: { ingressEvidenceId: "ev-in", egressEvidenceId: "ev-Z" } })).toEqual({
      ok: false, error: "EVIDENCE_MISMATCH",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("un caso terminal no se reevalúa", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    await evaluateIntegrityCase(evalDeps({ repository: repo, provider: new MockIntegrityVisionProvider("posible_dano") }), EVAL_INPUT);
    const q = await decideIntegrityCase(decideDeps(repo), "c1", cmd({ decision: "quarantine" }));
    expect(q.ok).toBe(true);
    const again = await evaluateIntegrityCase(evalDeps({ repository: repo }), EVAL_INPUT);
    expect(again).toEqual({ ok: false, error: "CASE_ALREADY_DECIDED" });
  });

  it("un caso de otro cliente es inexistente", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    await repo.reserveCase({ caseId: "c9", entity: ENTITY, selector: SELECTOR, createdAt: NOW, holder: "t", leaseUntil: "2026-08-09T11:05:00.000Z" });
    expect(await repo.findById("c9", CLIENT)).not.toBeNull();
    expect(await repo.findById("c9", OTHER_CLIENT)).toBeNull();
  });
});

// ===========================================================================
// R-1 · Autocertificación
// ===========================================================================

describe("R-1 · el caller no puede autocertificarse", () => {
  it("el comando no admite identidad ni fecha", () => {
    const c = cmd() as unknown as Record<string, unknown>;
    expect(Object.keys(c).sort()).toEqual(["decision", "inspectionEvidenceIds", "reason"].sort());
  });

  it("campos inyectados en el comando son IGNORADOS", () => {
    const poisoned = {
      ...cmd({ decision: "quarantine" }),
      actorUserId: "atacante", actorSessionId: "falsa", clientId: OTHER_CLIENT,
      permission: "admin.todo", decidedAt: "1999-01-01T00:00:00.000Z", role: "root",
    } as DecisionCommand;
    const r = applyHumanDecision({
      currentState: "REVIEW_REQUIRED", caseClientId: CLIENT, actor: ACTOR,
      command: poisoned, nowIso: NOW, currentChainHead: HEAD, releaseContext: RELEASE_CTX_OK,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record).toMatchObject({
      actorUserId: "user-1", actorSessionId: "sess-1", clientId: CLIENT,
      permission: CUSTODY_DECISION_PERMISSION, actorRole: "supervisor", decidedAt: NOW,
    });
  });

  it.each([
    [{ permissions: ["wms.edit"] }, "PERMISSION_DENIED"],
    [{ clientId: OTHER_CLIENT }, "CLIENT_MISMATCH"],
  ])("actor inválido %j → %s", (over, rejection) => {
    const r = applyHumanDecision({
      currentState: "REVIEW_REQUIRED", caseClientId: CLIENT,
      actor: { ...ACTOR, ...over }, command: cmd({ decision: "quarantine" }),
      nowIso: NOW, currentChainHead: HEAD, releaseContext: RELEASE_CTX_OK,
    });
    expect(r).toEqual({ ok: false, rejection });
  });

  it("sin actor verificado no hay decisión", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    const r = await decideIntegrityCase(decideDeps(repo, { authorization: new FakeAuth(null) }), "c1", cmd());
    expect(r).toEqual({ ok: false, error: "ACTOR_NOT_VERIFIED" });
  });

  it("un reloj inválido no produce decisión", () => {
    const r = applyHumanDecision({
      currentState: "REVIEW_REQUIRED", caseClientId: CLIENT, actor: ACTOR,
      command: cmd({ decision: "quarantine" }), nowIso: "nope",
      currentChainHead: HEAD, releaseContext: RELEASE_CTX_OK,
    });
    expect(r).toEqual({ ok: false, rejection: "CLOCK_INVALID" });
  });
});

// ===========================================================================
// Concurrencia de decisión · estados · hold
// ===========================================================================

describe("concurrencia de decisión y hold", () => {
  it("dos decisiones concurrentes: exactamente una gana", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    await evaluateIntegrityCase(evalDeps({ repository: repo }), EVAL_INPUT);
    const deps = decideDeps(repo);
    const [a, b] = await Promise.all([
      decideIntegrityCase(deps, "c1", cmd({ decision: "quarantine" })),
      decideIntegrityCase(deps, "c1", cmd({ decision: "quarantine" })),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
  });

  it("la cuarentena NO está sujeta a la política de liberación", () => {
    const r = applyHumanDecision({
      currentState: "REVIEW_REQUIRED", caseClientId: CLIENT, actor: ACTOR,
      command: cmd({ decision: "quarantine", reason: "Daño visible confirmado en inspección." }),
      nowIso: NOW, currentChainHead: null,
      releaseContext: { holdReasons: ["VERDICT_POSSIBLE_DAMAGE"], evidenceOk: true, chain: null, assessment: null, canonicalInspectionEvidenceIds: [] },
    });
    expect(r.ok && r.state).toBe("QUARANTINED");
  });

  it("la derivación automática nunca alcanza un terminal", () => {
    const chains: ChainVerification[] = [
      CHAIN_OK,
      { status: "invalid", eventsChecked: 1, verifiedAt: NOW, firstError: null },
      { status: "unverifiable", verifiedAt: NOW, error: "x" },
    ];
    for (const chain of chains) {
      for (const verdict of ["coincide", "diferencias", "posible_dano"] as const) {
        const s = deriveIntegrityCaseState({
          evidence: { ok: true, problems: [], eventIds: ["evt-in"] }, chain, assessment: realAssessment({ verdict }),
        }).state;
        expect(["PENDING_EVIDENCE", "REVIEW_REQUIRED"]).toContain(s);
      }
    }
  });

  it("un caso impecable IGUAL va a revisión humana", () => {
    expect(deriveIntegrityCaseState({
      evidence: { ok: true, problems: [], eventIds: ["evt-in", "evt-out"] }, chain: CHAIN_OK, assessment: realAssessment(),
    })).toEqual({ state: "REVIEW_REQUIRED", reasons: ["NO_CALIBRATED_THRESHOLD"] });
  });

  it("el hold bloquea las cinco etapas", () => {
    expect(HELD_OPERATIONS).toEqual(["reserve", "picking", "packing", "loading", "dispatch"]);
    for (const op of HELD_OPERATIONS) {
      for (const st of ["PENDING_EVIDENCE", "REVIEW_REQUIRED", "QUARANTINED"] as const) {
        expect(canPerform(op, st)).toBe(false);
        expect(holdsOperations(st)).toBe(true);
      }
      expect(canPerform(op, "RELEASED")).toBe(true);
    }
  });
});

// ===========================================================================
// Flags
// ===========================================================================

describe("feature flags", () => {
  it("todos OFF con entorno vacío", () => {
    expect(readFlags({})).toEqual({ ingressUi: false, visionCompare: false, holdEnforcement: false, publicCertificate: false });
  });
  it("sólo el literal '1' enciende", () => {
    expect(isFlagEnabled("visionCompare", { CUSTODY_IA_VISION_COMPARE: "1" })).toBe(true);
    for (const v of ["true", "on", "yes", "0", "", " 1"]) {
      expect(isFlagEnabled("visionCompare", { CUSTODY_IA_VISION_COMPARE: v })).toBe(false);
    }
  });
});

// ===========================================================================
// CONTRACT/DESIGN TEST ONLY — no sustituye una prueba de base de datos
// ===========================================================================

describe("CONTRACT/DESIGN TEST ONLY · SQL de diseño", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "docs/handoff/WMS-CUSTODY-IA-0221-DESIGN.sql"),
    "utf8"
  );

  it("no está en supabase/migrations y se declara DESIGN ONLY", () => {
    expect(sql).toMatch(/NO ES UNA MIGRACI[ÓO]N/);
    expect(sql).toMatch(/DESIGN ONLY \/ NOT EXECUTABLE \/ NOT READY FOR LEASE/);
  });

  it("usa el join real custody_evidence → custody_events y NO columnas inexistentes", () => {
    expect(sql).toMatch(/custody_evidence[\s\S]{0,400}event_id[\s\S]{0,400}custody_events/);
    expect(sql).not.toMatch(/custody_evidence\.packing_unit_id/);
    expect(sql).not.toMatch(/custody_evidence\.shipment_id/);
    expect(sql).not.toMatch(/\be\.packing_unit_id/);
  });

  it("la autorización es NULL-safe y los privilegios son mínimos", () => {
    expect(sql).toMatch(/coalesce\(\s*public\.has_permission\(/);
    expect(sql).toMatch(/revoke all on function/);
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).not.toMatch(/grant[^;]*\bto\s+public\b/i);
  });

  it("la RPC usa FOR UPDATE, CAS y RETURNING con verificación de filas", () => {
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/p_expected_version/);
    expect(sql).toMatch(/returning/i);
    expect(sql).toMatch(/get diagnostics|row_count/i);
  });

  it("exige exactamente NO_CALIBRATED_THRESHOLD para liberar", () => {
    expect(sql).toMatch(/NO_CALIBRATED_THRESHOLD/);
  });

  it("bloquea UPDATE, DELETE y TRUNCATE en las tablas append-only", () => {
    expect(sql).toMatch(/before update or delete on public\.custody_integrity_decisions/);
    expect(sql).toMatch(/before truncate on public\.custody_integrity_decisions/);
  });

  it("la RLS no se apoya sólo en auth.role()", () => {
    expect(sql).toMatch(/to authenticated/);
    expect(sql).toMatch(/current_client_id\(\)/);
    expect(sql).not.toMatch(/using \(auth\.role\(\) = 'authenticated'\)/);
  });
});

// ===========================================================================
// R3 · Frontera sellada, identidad de proveedor, lease recuperable
// ===========================================================================

describe("R3-1 · el repositorio no acepta artefactos compuestos por el caller", () => {
  async function seeded() {
    const repo = new InMemoryIntegrityCaseRepository();
    await evaluateIntegrityCase(evalDeps({ repository: repo }), EVAL_INPUT);
    const c = await repo.findById("c1", CLIENT);
    return { repo, version: c?.version ?? 1 };
  }

  it("la secuencia directa reserve → recordAssessment → applyDecision NO alcanza RELEASED", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    await repo.reserveCase({
      caseId: "d1", entity: ENTITY, selector: SELECTOR, createdAt: NOW,
      holder: "atacante", leaseUntil: "2026-08-09T11:05:00.000Z",
    });
    // Objetos sintéticos con forma correcta, NO producidos por el dominio.
    const fakeChain = { status: "verified", attestation: { scope: "physical_unit", entityId: "pu-0001", chainHead: HEAD, eventsChecked: 4, verifiedEventIds: ["evt-in", "evt-out"], attestedAt: NOW } } as ChainVerification;
    const rec = await repo.recordAssessment({
      caseId: "d1", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: caseBinding("d1", CLIENT, "pu-0001"),
      outcome: {
        entity: { ...ENTITY, entityId: "pu-0001" }, selector: SELECTOR,
        evidence: { ingress: INGRESS, egress: EGRESS },
        chain: fakeChain,
        assessment: { outcome: "ok", verdict: "coincide", modelConfidence: 0.99, observations: [], zones: [], error: null,
          provenance: { provider: "authorized-provider", model: "m", promptVersion: "v", executionMode: "real", requestedAt: NOW, completedAt: NOW } },
        state: "REVIEW_REQUIRED", holdReasons: ["NO_CALIBRATED_THRESHOLD"], evaluatedAt: NOW,
      },
    });
    expect(rec).toEqual({ ok: false, failure: "ARTIFACT_NOT_CANONICAL" });

    const dec = await repo.applyDecision({
      caseId: "d1", clientId: CLIENT, expectedVersion: 1, expectedState: "REVIEW_REQUIRED",
      newState: "RELEASED", updatedAt: NOW, currentChainHead: HEAD,
      record: record({ decision: "release", newState: "RELEASED", inspectionEvidenceIds: ["ev-insp"] }),
      inspectionProof: { ok: true, problems: [], evidenceIds: ["ev-insp"] },
      boundTo: caseBinding("d1", CLIENT, "pu-0001"),
    });
    expect(dec).toEqual({ ok: false, failure: "ARTIFACT_NOT_CANONICAL" });

    const after = await repo.findById("d1", CLIENT);
    expect(after?.state).not.toBe("RELEASED");
  });

  it("un ID de inspección arbitrario no pasa aunque el sello sea legítimo", async () => {
    const { repo, version } = await seeded();
    const proof = buildInspectionProof("c1", ENTITY, ["arbitrario"], [], []);
    const r = await repo.applyDecision({
      caseId: "c1", clientId: CLIENT, expectedVersion: version, expectedState: "REVIEW_REQUIRED",
      newState: "RELEASED", updatedAt: NOW, currentChainHead: HEAD,
      record: record({ decision: "release", newState: "RELEASED", inspectionEvidenceIds: ["arbitrario"] }),
      inspectionProof: proof, boundTo: BOUND,
    });
    expect(r).toEqual({ ok: false, failure: "INSPECTION_PROOF_INVALID" });
  });

  it("un artefacto sellado para OTRO caso no sirve", async () => {
    const { repo, version } = await seeded();
    const otherBound = caseBinding("otro-caso", CLIENT, "pu-0001");
    const r = await repo.applyDecision({
      caseId: "c1", clientId: CLIENT, expectedVersion: version, expectedState: "REVIEW_REQUIRED",
      newState: "QUARANTINED", updatedAt: NOW, currentChainHead: HEAD, record: record(),
      inspectionProof: buildInspectionProof("otro-caso", ENTITY, [], [], []),
      boundTo: BOUND,
    });
    expect(r).toEqual({ ok: false, failure: "ARTIFACT_NOT_CANONICAL" });
  });

  it.each([["INVENTADO"], [""], [null], [undefined]])("newState=%p se valida en runtime", async (bad) => {
    const { repo, version } = await seeded();
    const r = await repo.applyDecision({
      caseId: "c1", clientId: CLIENT, expectedVersion: version, expectedState: "REVIEW_REQUIRED",
      newState: bad as never, updatedAt: NOW, currentChainHead: HEAD, record: record(),
      inspectionProof: buildInspectionProof("c1", ENTITY, [], [], []), boundTo: BOUND,
    });
    expect(r).toEqual({ ok: false, failure: "RECORD_INCOHERENT" });
  });
});

describe("R3-3 · chainHeadAtDecision", () => {
  async function seeded() {
    const repo = new InMemoryIntegrityCaseRepository();
    await evaluateIntegrityCase(evalDeps({ repository: repo }), EVAL_INPUT);
    const c = await repo.findById("c1", CLIENT);
    return { repo, version: c?.version ?? 1 };
  }

  it.each([[null], ["otro-head"], ["chainhead-historico"]])(
    "head %p en el record bloquea la liberación",
    async (head) => {
      const { repo, version } = await seeded();
      const r = await repo.applyDecision({
        caseId: "c1", clientId: CLIENT, expectedVersion: version, expectedState: "REVIEW_REQUIRED",
        newState: "RELEASED", updatedAt: NOW, currentChainHead: HEAD,
        record: record({ decision: "release", newState: "RELEASED", chainHeadAtDecision: head, inspectionEvidenceIds: ["ev-insp"] }),
        inspectionProof: buildInspectionProof("c1", ENTITY, ["ev-insp"], [ev({ evidenceId: "ev-insp", eventId: "evt-insp" })], []),
        boundTo: BOUND,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(["INSPECTION_PROOF_INVALID", "ATTESTATION_STALE"]).toContain(r.failure);
    }
  );

  it("el certificado exige el conjunto canónico exacto de inspección", () => {
    const decision = record({ decision: "release", newState: "RELEASED", inspectionEvidenceIds: ["ev-insp"] });
    const base = {
      state: "RELEASED" as const, caseClientId: CLIENT, requesterClientId: CLIENT,
      evidenceOk: true, evidenceEventIds: ["evt-in", "evt-out"], chain: CHAIN_OK,
      assessment: realAssessment(), decision,
      canonicalInspectionEvidenceIds: ["ev-insp"],
      currentChainHead: HEAD, issuedAt: NOW,
    };
    expect(evaluateCertificateEligibility(base).document).toBe("certificate");
    // Conjunto distinto del canónico → acta.
    const r = evaluateCertificateEligibility({ ...base, canonicalInspectionEvidenceIds: ["otro"] });
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toContain("INSPECTION_SET_NOT_CANONICAL");
    // Conjunto canónico vacío → acta.
    expect(evaluateCertificateEligibility({ ...base, canonicalInspectionEvidenceIds: [] }).blockers)
      .toContain("INSPECTION_SET_NOT_CANONICAL");
  });
});

describe("R3-4 · reserva recuperable", () => {
  it("un fallo del evidence loader NO deja una reserva permanente", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    class BrokenLoader implements EvidenceLoaderPort {
      async loadPair(): Promise<never> {
        throw new Error("loader caído");
      }
      async loadInspectionEvidence() {
        return [];
      }
    }
    const r = await evaluateIntegrityCase(
      evalDeps({ repository: repo, evidenceLoader: new BrokenLoader() }),
      EVAL_INPUT
    );
    // Resultado TIPADO, no excepción.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.case.state).toBe("PENDING_EVIDENCE");
    expect(r.case.assessment?.error).toMatch(/loader/);
    // Lease liberado: el caso es recuperable.
    expect(r.case.evaluationLease).toBeNull();
  });

  it("un lease vencido puede reclamarse; uno vigente no", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    await repo.reserveCase({
      caseId: "L1", entity: ENTITY, selector: SELECTOR, createdAt: NOW,
      holder: "primero", leaseUntil: "2026-08-09T11:05:00.000Z",
    });
    const vigente = await repo.reserveCase({
      caseId: "L1", entity: ENTITY, selector: SELECTOR, createdAt: "2026-08-09T11:01:00.000Z",
      holder: "segundo", leaseUntil: "2026-08-09T11:06:00.000Z",
    });
    expect(vigente.ok && vigente.claimed).toBe(false);

    const vencido = await repo.reserveCase({
      caseId: "L1", entity: ENTITY, selector: SELECTOR, createdAt: "2026-08-09T11:30:00.000Z",
      holder: "tercero", leaseUntil: "2026-08-09T11:35:00.000Z",
    });
    expect(vencido.ok && vencido.claimed).toBe(true);
  });
});

// ===========================================================================
// CONTRACT/DESIGN TEST ONLY · invariantes R3-5 del SQL de diseño
// ===========================================================================

describe("CONTRACT/DESIGN TEST ONLY · SQL revisión 4 (R3-5)", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "docs/handoff/WMS-CUSTODY-IA-0221-DESIGN.sql"),
    "utf8"
  );

  it("la rama release está deshabilitada incondicionalmente", () => {
    expect(sql).toMatch(/LIBERACI[ÓO]N DESHABILITADA/);
    expect(sql).toMatch(/if p_decision = 'release' then[\s\S]{0,400}raise exception/);
    expect(sql).toMatch(/feature_not_supported/);
  });

  it("la cuarentena sigue permitida", () => {
    expect(sql).toMatch(/quarantine/);
    expect(sql).not.toMatch(/CUARENTENA DESHABILITADA/);
  });

  it("el caller no declara hechos de evaluación ni de cadena", () => {
    const upsert = sql.slice(
      sql.indexOf("create or replace function public.upsert_custody_integrity_assessment"),
      sql.indexOf("revoke all on function public.upsert_custody_integrity_assessment")
    );
    for (const p of [
      "p_execution_mode", "p_outcome", "p_verdict", "p_model_confidence",
      "p_chain_status", "p_chain_events_checked", "p_chain_head", "p_chain_attested_at",
    ]) {
      expect(upsert).not.toContain(p);
    }
  });

  it("no acepta p_current_chain_head como acreditación del head vigente", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.decide_custody_integrity"));
    expect(fn).not.toMatch(/p_current_chain_head/);
    expect(fn).toMatch(/order by ev\.chain_seq desc limit 1/);
  });

  it("session_id sale del JWT validado, no de un GUC individual", () => {
    expect(sql).toMatch(/auth\.jwt\(\)\s*->>\s*'session_id'/);
    expect(sql).not.toMatch(/request\.jwt\.claim\.session_id/);
    expect(sql).toMatch(/from auth\.sessions/);
  });

  it("los helpers SECURITY DEFINER no quedan expuestos a authenticated", () => {
    expect(sql).toMatch(/revoke all on function public\.custody_evidence_scope\(uuid\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on function public\.custody_entity_client_id\(text, uuid\) from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant execute on function public\.custody_evidence_scope/);
    expect(sql).not.toMatch(/grant execute on function public\.custody_entity_client_id/);
  });

  it("revoca a authenticated antes de conceder lo mínimo", () => {
    expect(sql).toMatch(/revoke all on public\.custody_integrity_cases\s+from public, anon, authenticated;/);
    expect(sql).toMatch(/grant select on public\.custody_integrity_cases\s+to authenticated;/);
  });

  it("ninguna evidencia existente se reinterpreta como inspección humana", () => {
    expect(sql).toMatch(/NINGUNA fila de custody_evidence puede reinterpretarse/);
  });
});

// ===========================================================================
// R4-1 · Derivación canónica dentro del repositorio
// ===========================================================================

describe("R4-1 · el repositorio recalcula el binding y exige artefactos canónicos", () => {
  async function reserved(caseId = "k1") {
    const repo = new InMemoryIntegrityCaseRepository();
    await repo.reserveCase({
      caseId, entity: ENTITY, selector: SELECTOR, createdAt: NOW,
      holder: "t", leaseUntil: "2026-08-09T11:05:00.000Z",
    });
    return repo;
  }

  async function canonicalOutcome(caseId = "k1") {
    return buildEvaluationOutcome({
      caseId, entity: ENTITY, selector: SELECTOR,
      pair: { ingress: INGRESS, egress: EGRESS },
      provider: REAL_PROVIDER, registry: REGISTRY,
      verifyChain: chainPort(), evaluatedAt: NOW, now: () => NOW,
    });
  }

  it("un boundTo autocreado por el caller no sirve", async () => {
    const repo = await reserved();
    const r = await repo.recordAssessment({
      caseId: "k1", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: "binding-inventado",
      outcome: await canonicalOutcome(),
    });
    expect(r).toEqual({ ok: false, failure: "BINDING_MISMATCH" });
  });

  it("un binding de OTRO caso no sirve", async () => {
    const repo = await reserved();
    const r = await repo.recordAssessment({
      caseId: "k1", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: caseBinding("otro", CLIENT, "pu-0001"),
      outcome: await canonicalOutcome(),
    });
    expect(r).toEqual({ ok: false, failure: "BINDING_MISMATCH" });
  });

  it("un outcome canónico de OTRO caso, con el binding correcto, tampoco sirve", async () => {
    const repo = await reserved();
    const r = await repo.recordAssessment({
      caseId: "k1", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: caseBinding("k1", CLIENT, "pu-0001"),
      outcome: await canonicalOutcome("otro-caso"),
    });
    expect(r).toEqual({ ok: false, failure: "ARTIFACT_NOT_CANONICAL" });
  });

  it("state y holdReasons declarados por el caller no controlan la persistencia", async () => {
    const repo = await reserved();
    const outcome = await canonicalOutcome();
    // El caller intenta imponer un estado y holds distintos mutando su copia.
    const forged = { ...outcome, state: "PENDING_EVIDENCE", holdReasons: [] };
    const bad = await repo.recordAssessment({
      caseId: "k1", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: caseBinding("k1", CLIENT, "pu-0001"),
      outcome: forged as never,
    });
    expect(bad).toEqual({ ok: false, failure: "ARTIFACT_NOT_CANONICAL" });

    // Con el outcome auténtico, lo persistido es lo DERIVADO, no lo pedido.
    const good = await repo.recordAssessment({
      caseId: "k1", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: caseBinding("k1", CLIENT, "pu-0001"),
      outcome,
    });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.case.state).toBe("REVIEW_REQUIRED");
    expect(good.case.holdReasons).toEqual(["NO_CALIBRATED_THRESHOLD"]);
  });

  it("datos aparentemente válidos pero no derivados no alcanzan RELEASED", async () => {
    const repo = await reserved("k2");
    const r = await repo.recordAssessment({
      caseId: "k2", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: caseBinding("k2", CLIENT, "pu-0001"),
      outcome: {
        entity: ENTITY, selector: SELECTOR,
        evidence: { ingress: INGRESS, egress: EGRESS },
        chain: CHAIN_OK, assessment: realAssessment(),
        state: "REVIEW_REQUIRED", holdReasons: ["NO_CALIBRATED_THRESHOLD"], evaluatedAt: NOW,
      } as never,
    });
    expect(r).toEqual({ ok: false, failure: "ARTIFACT_NOT_CANONICAL" });
    const after = await repo.findById("k2", CLIENT);
    expect(after?.state).toBe("PENDING_EVIDENCE");
  });

  it("con INSPECTION_PAIRS vacío, ninguna ruta directa termina en RELEASED", async () => {
    const repo = await reserved("k3");
    const outcome = await canonicalOutcome("k3");
    const bind = caseBinding("k3", CLIENT, "pu-0001");
    await repo.recordAssessment({
      caseId: "k3", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW, boundTo: bind, outcome,
    });
    const c = await repo.findById("k3", CLIENT);
    const r = await repo.applyDecision({
      caseId: "k3", clientId: CLIENT, expectedVersion: c?.version ?? 2,
      expectedState: "REVIEW_REQUIRED", newState: "RELEASED", updatedAt: NOW,
      currentChainHead: HEAD,
      record: record({ decision: "release", newState: "RELEASED", inspectionEvidenceIds: ["ev-insp"] }),
      inspectionProof: buildInspectionProof("k3", ENTITY, ["ev-insp"], [ev({ evidenceId: "ev-insp", eventId: "evt-insp" })], []),
      boundTo: bind,
    });
    expect(r).toEqual({ ok: false, failure: "INSPECTION_PROOF_INVALID" });
    expect((await repo.findById("k3", CLIENT))?.state).not.toBe("RELEASED");
  });
});

// ===========================================================================
// R4-2 · Head de decisión en el certificado
// ===========================================================================

describe("R4-2 · chainHeadAtDecision en el certificado", () => {
  const decision = record({
    decision: "release", newState: "RELEASED",
    inspectionEvidenceIds: ["ev-insp"], chainHeadAtDecision: HEAD,
  });
  const base = {
    state: "RELEASED" as const, caseClientId: CLIENT, requesterClientId: CLIENT,
    evidenceOk: true, evidenceEventIds: ["evt-in", "evt-out"], chain: CHAIN_OK,
    assessment: realAssessment(), decision,
    canonicalInspectionEvidenceIds: ["ev-insp"],
    currentChainHead: HEAD, issuedAt: NOW,
  };

  it("head, tiempos y conjunto canónico coherentes → certificate", () => {
    expect(evaluateCertificateEligibility(base)).toEqual({ document: "certificate", blockers: [] });
  });

  it.each([[null], [""], ["head-historico"], ["otro-head"]])(
    "decision.chainHeadAtDecision=%p → acta",
    (head) => {
      const r = evaluateCertificateEligibility({
        ...base, decision: { ...decision, chainHeadAtDecision: head },
      });
      expect(r.document).toBe("acta_inspeccion");
      expect(r.blockers).toContain("DECISION_CHAIN_HEAD_MISMATCH");
    }
  );

  it("V4-bis · la punta viva avanzó tras la liberación → SIGUE siendo certificate", () => {
    const r = evaluateCertificateEligibility({ ...base, currentChainHead: "otro-head" });
    expect(r).toEqual({ document: "certificate", blockers: [] });
  });

  it("atestación vencida en decidedAt → acta", () => {
    const stale = new Date(Date.parse(NOW) - 120 * 60_000).toISOString();
    const r = evaluateCertificateEligibility({
      ...base, decision: { ...decision, decidedAt: stale },
    });
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toContain("DECISION_CHAIN_HEAD_MISMATCH");
  });

  it("V4-bis · emisión mucho después de la liberación → SIGUE siendo certificate", () => {
    const nextDay = new Date(Date.parse(NOW) + 24 * 60 * 60_000).toISOString();
    const r = evaluateCertificateEligibility({ ...base, issuedAt: nextDay });
    expect(r).toEqual({ document: "certificate", blockers: [] });
  });
});

// ===========================================================================
// R5 · Snapshots profundos: mutar el handle no cambia la autoridad
// ===========================================================================

describe("R5 · inmutabilidad profunda del outcome canónico", () => {
  const OUT_BIND = caseBinding("m1", CLIENT, "pu-0001");

  async function canonical(pair = { ingress: INGRESS, egress: EGRESS }) {
    return buildEvaluationOutcome({
      caseId: "m1", entity: ENTITY, selector: SELECTOR, pair,
      provider: REAL_PROVIDER, registry: REGISTRY,
      verifyChain: chainPort(), evaluatedAt: NOW, now: () => NOW,
    });
  }

  /** Intenta mutar; en modo estricto puede lanzar. Ambas cosas son aceptables. */
  function tryMutate(fn: () => void): void {
    try { fn(); } catch { /* congelado */ }
  }

  it("EL DEFECTO DEL C4: redactar la evidencia tras derivar NO se persiste", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    await repo.reserveCase({
      caseId: "m1", entity: ENTITY, selector: SELECTOR, createdAt: NOW,
      holder: "t", leaseUntil: "2026-08-09T11:05:00.000Z",
    });
    const outcome = await canonical();
    expect(outcome.holdReasons).toEqual(["NO_CALIBRATED_THRESHOLD"]);

    // Secuencia exacta reproducida por el C4.
    tryMutate(() => {
      (outcome.evidence.ingress as unknown as { redacted: boolean }).redacted = true;
    });

    const r = await repo.recordAssessment({
      caseId: "m1", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: OUT_BIND, outcome,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Lo persistido viene del snapshot privado: evidencia NO redactada.
    expect(r.case.evidence.ingress?.redacted).toBe(false);
    expect(r.case.holdReasons).toEqual(["NO_CALIBRATED_THRESHOLD"]);
  });

  it.each([
    ["evidence.ingress.redacted", (o: EvaluationOutcome) => { (o.evidence.ingress as unknown as { redacted: boolean }).redacted = true; }],
    ["evidence.ingress.clientId", (o: EvaluationOutcome) => { (o.evidence.ingress as unknown as { clientId: string }).clientId = OTHER_CLIENT; }],
    ["entity.clientId", (o: EvaluationOutcome) => { (o.entity as unknown as { clientId: string }).clientId = OTHER_CLIENT; }],
    ["entity.entityId", (o: EvaluationOutcome) => { (o.entity as unknown as { entityId: string }).entityId = "pu-OTRA"; }],
    ["selector", (o: EvaluationOutcome) => { (o.selector as unknown as { ingressEvidenceId: string }).ingressEvidenceId = "ev-X"; }],
    ["chain.attestation.chainHead", (o: EvaluationOutcome) => { if (o.chain.status === "verified") (o.chain.attestation as unknown as { chainHead: string }).chainHead = "otro"; }],
    ["chain.attestation.attestedAt", (o: EvaluationOutcome) => { if (o.chain.status === "verified") (o.chain.attestation as unknown as { attestedAt: string }).attestedAt = "1999-01-01T00:00:00.000Z"; }],
    ["verifiedEventIds", (o: EvaluationOutcome) => { if (o.chain.status === "verified") (o.chain.attestation.verifiedEventIds as string[]).push("colado"); }],
    ["assessment.outcome", (o: EvaluationOutcome) => { (o.assessment as unknown as { outcome: string }).outcome = "timeout"; }],
    ["assessment.verdict", (o: EvaluationOutcome) => { (o.assessment as unknown as { verdict: string }).verdict = "posible_dano"; }],
    ["provenance.executionMode", (o: EvaluationOutcome) => { (o.assessment.provenance as unknown as { executionMode: string }).executionMode = "cached"; }],
    ["observations", (o: EvaluationOutcome) => { o.assessment.observations.push("inyectada"); }],
    ["zones", (o: EvaluationOutcome) => { o.assessment.zones.push("inyectada"); }],
    ["holdReasons", (o: EvaluationOutcome) => { (o.holdReasons as HoldReason[]).push("CHAIN_INVALID"); }],
  ])("mutar %s no altera lo persistido", async (_label, mutate) => {
    const repo = new InMemoryIntegrityCaseRepository();
    await repo.reserveCase({
      caseId: "m1", entity: ENTITY, selector: SELECTOR, createdAt: NOW,
      holder: "t", leaseUntil: "2026-08-09T11:05:00.000Z",
    });
    const outcome = await canonical();
    tryMutate(() => mutate(outcome));

    const r = await repo.recordAssessment({
      caseId: "m1", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: OUT_BIND, outcome,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.case.state).toBe("REVIEW_REQUIRED");
    expect(r.case.holdReasons).toEqual(["NO_CALIBRATED_THRESHOLD"]);
    expect(r.case.evidence.ingress?.redacted).toBe(false);
    expect(r.case.evidence.ingress?.clientId).toBe(CLIENT);
    expect(r.case.entity.clientId).toBe(CLIENT);
    expect(r.case.entity.entityId).toBe("pu-0001");
    expect(r.case.assessment?.outcome).toBe("ok");
    expect(r.case.assessment?.verdict).toBe("coincide");
    expect(r.case.assessment?.provenance.executionMode).toBe("real");
    // El mock produce su propia observación determinista; lo que NUNCA debe
    // aparecer es lo inyectado por el caller tras construir el outcome.
    expect(r.case.assessment?.observations).not.toContain("inyectada");
    expect(r.case.assessment?.zones).not.toContain("inyectada");
    if (r.case.chain?.status === "verified") {
      expect(r.case.chain.attestation.chainHead).toBe(HEAD);
      expect(r.case.chain.attestation.attestedAt).toBe(NOW);
      expect([...r.case.chain.attestation.verifiedEventIds]).toEqual(["evt-in", "evt-out"]);
    }
  });

  it("mutar el pair ORIGINAL mientras verifyChain está pendiente no cambia el snapshot", async () => {
    const mutable = { ingress: { ...INGRESS }, egress: { ...EGRESS } };
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const slowChain = vi.fn().mockImplementation(async () => {
      await gate;
      return {
        valid: true, events_checked: 4, first_error: null,
        verified_event_ids: ["evt-in", "evt-out"],
        chain_head: HEAD, attested_at: NOW, scope: "physical_unit", entity_id: "pu-0001",
      };
    });

    const pending = buildEvaluationOutcome({
      caseId: "m1", entity: ENTITY, selector: SELECTOR, pair: mutable,
      provider: REAL_PROVIDER, registry: REGISTRY,
      verifyChain: slowChain, evaluatedAt: NOW, now: () => NOW,
    });

    // El caller muta SU objeto mientras la verificación está en vuelo.
    mutable.ingress.redacted = true;
    mutable.ingress.clientId = OTHER_CLIENT;
    mutable.egress.sha256 = "f".repeat(64);
    release();

    const outcome = await pending;
    expect(outcome.evidence.ingress?.redacted).toBe(false);
    expect(outcome.evidence.ingress?.clientId).toBe(CLIENT);
    expect(outcome.evidence.egress?.sha256).toBe(SHA_B);
    expect(outcome.holdReasons).toEqual(["NO_CALIBRATED_THRESHOLD"]);
  });

  it("una evidencia realmente redactada SÍ produce su hold y nunca el de evidencia válida", async () => {
    const outcome = await canonical({ ingress: { ...INGRESS, redacted: true }, egress: EGRESS });
    expect(outcome.holdReasons).toContain("EVIDENCE_REDACTED");
    expect(outcome.holdReasons).not.toEqual(["NO_CALIBRATED_THRESHOLD"]);
  });

  it("el repositorio no conserva referencias externas al handle", async () => {
    const repo = new InMemoryIntegrityCaseRepository();
    await repo.reserveCase({
      caseId: "m1", entity: ENTITY, selector: SELECTOR, createdAt: NOW,
      holder: "t", leaseUntil: "2026-08-09T11:05:00.000Z",
    });
    const outcome = await canonical();
    const r = await repo.recordAssessment({
      caseId: "m1", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: OUT_BIND, outcome,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.case.evidence.ingress).not.toBe(outcome.evidence.ingress);
    expect(r.case.chain).not.toBe(outcome.chain);
    expect(r.case.assessment).not.toBe(outcome.assessment);
  });

  it("mutar inspectionProof.evidenceIds no altera la autoridad", async () => {
    const proof = buildInspectionProof("m1", ENTITY, ["ev-insp"], [ev({ evidenceId: "ev-insp", eventId: "evt-insp" })], []);
    tryMutate(() => { (proof.evidenceIds as string[]).push("colado"); });
    // Con INSPECTION_PAIRS vacío la prueba es inválida y sigue siéndolo.
    expect(proof.ok).toBe(false);
    expect([...proof.evidenceIds]).toEqual([]);
  });
});

// ===========================================================================
// R6 · Consistencia evidencia ↔ proveedor ↔ persistencia
// ===========================================================================

describe("R6 · captura antes de la primera frontera async", () => {
  const R6_BIND = caseBinding("r6", CLIENT, "pu-0001");

  async function seededRepo() {
    const repo = new InMemoryIntegrityCaseRepository();
    await repo.reserveCase({
      caseId: "r6", entity: ENTITY, selector: SELECTOR, createdAt: NOW,
      holder: "t", leaseUntil: "2026-08-09T11:05:00.000Z",
    });
    return repo;
  }

  /** Proveedor que se puede pausar y que registra lo que efectivamente comparó. */
  class PausableProvider implements IntegrityVisionProvider {
    readonly descriptor: ProviderDescriptor = {
      name: "authorized-provider", model: "m",
      promptVersion: "custody-integrity/v2", declaredMode: "real",
    };
    calls = 0;
    seen: { ingressSha: string; ingressRedacted: boolean; egressSha: string } | null = null;
    private release!: () => void;
    readonly gate = new Promise<void>((res) => { this.release = res; });
    resume() { this.release(); }
    async compare(req: CompareRequest): Promise<RawProviderPayload> {
      this.calls += 1;
      this.seen = {
        ingressSha: req.ingress.sha256,
        ingressRedacted: req.ingress.redacted,
        egressSha: req.egress.sha256,
      };
      await this.gate;
      return { outcome: "ok", verdict: "coincide", modelConfidence: 0.9 };
    }
  }

  it("R6-1 · mutar el pair durante compare: lo comparado == lo persistido", async () => {
    const repo = await seededRepo();
    const provider = new PausableProvider();
    const registry = new ProviderRegistry();
    registry.register(provider, {
      provider: "authorized-provider", model: "m",
      promptVersion: "custody-integrity/v2", executionMode: "real",
    });
    const mutable = { ingress: { ...INGRESS }, egress: { ...EGRESS } };

    const pending = buildEvaluationOutcome({
      caseId: "r6", entity: ENTITY, selector: SELECTOR, pair: mutable,
      provider, registry, verifyChain: chainPort(), evaluatedAt: NOW, now: () => NOW,
    });

    // El caller muta su objeto mientras `compare` está en vuelo.
    await Promise.resolve();
    mutable.ingress.redacted = true;
    mutable.ingress.sha256 = "c".repeat(64);
    mutable.egress.sha256 = "d".repeat(64);
    provider.resume();

    const outcome = await pending;
    const r = await repo.recordAssessment({
      caseId: "r6", clientId: CLIENT, expectedVersion: 1, updatedAt: NOW,
      boundTo: R6_BIND, outcome,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Bytes comparados == bytes persistidos, y ninguno cambió por fuera.
    expect(provider.seen?.ingressSha).toBe(SHA_A);
    expect(provider.seen?.egressSha).toBe(SHA_B);
    expect(provider.seen?.ingressRedacted).toBe(false);
    expect(r.case.evidence.ingress?.sha256).toBe(provider.seen?.ingressSha);
    expect(r.case.evidence.egress?.sha256).toBe(provider.seen?.egressSha);
    expect(r.case.evidence.ingress?.redacted).toBe(false);
    expect(provider.calls).toBe(1);
  });

  it("R6-2 · registrar el provider DESPUÉS del await no convierte mock en real", async () => {
    const provider = new PausableProvider();
    const registry = new ProviderRegistry(); // vacío al capturar
    const pending = buildEvaluationOutcome({
      caseId: "r6", entity: ENTITY, selector: SELECTOR,
      pair: { ingress: INGRESS, egress: EGRESS },
      provider, registry, verifyChain: chainPort(), evaluatedAt: NOW, now: () => NOW,
    });
    await Promise.resolve();
    // Registro tardío: no debe tener efecto.
    registry.register(provider, {
      provider: "authorized-provider", model: "m",
      promptVersion: "custody-integrity/v2", executionMode: "real",
    });
    provider.resume();
    const outcome = await pending;
    expect(outcome.assessment.provenance.executionMode).toBe("mock");
    expect(outcome.holdReasons).toContain("NON_REAL_EXECUTION");
  });

  it("R6-2 · sustituir input.provider durante una espera no cambia el resultado", async () => {
    const provider = new PausableProvider();
    const registry = new ProviderRegistry();
    registry.register(provider, {
      provider: "authorized-provider", model: "m",
      promptVersion: "custody-integrity/v2", executionMode: "real",
    });
    const impostor = new MockIntegrityVisionProvider("posible_dano", "authorized-provider", "real");
    const mutableInput = {
      caseId: "r6", entity: ENTITY, selector: SELECTOR,
      pair: { ingress: INGRESS, egress: EGRESS },
      provider: provider as IntegrityVisionProvider,
      registry, verifyChain: chainPort(), evaluatedAt: NOW, now: () => NOW,
    };
    const pending = buildEvaluationOutcome(mutableInput);
    await Promise.resolve();
    mutableInput.provider = impostor; // sustitución tardía
    provider.resume();
    const outcome = await pending;
    // Ganó la referencia capturada: veredicto del pausable, modo real.
    expect(outcome.assessment.verdict).toBe("coincide");
    expect(outcome.assessment.provenance.executionMode).toBe("real");
    expect(provider.calls).toBe(1);
  });

  it("R6-2 · mutar input.evaluatedAt durante una espera no cambia el instante", async () => {
    const provider = new PausableProvider();
    const registry = new ProviderRegistry();
    const mutableInput = {
      caseId: "r6", entity: ENTITY, selector: SELECTOR,
      pair: { ingress: INGRESS, egress: EGRESS },
      provider: provider as IntegrityVisionProvider,
      registry, verifyChain: chainPort(), evaluatedAt: NOW, now: () => NOW,
    };
    const pending = buildEvaluationOutcome(mutableInput);
    await Promise.resolve();
    mutableInput.evaluatedAt = "1999-01-01T00:00:00.000Z";
    provider.resume();
    const outcome = await pending;
    expect(outcome.evaluatedAt).toBe(NOW);
    expect(outcome.assessment.provenance.requestedAt).toBe(NOW);
  });

  it("R6-3 · no existe API pública para un outcome desde un payload libre", async () => {
    const mod = await import("./custody/integrity");
    const keys = Object.keys(mod);
    expect(keys).toContain("buildEvaluationOutcome");
    // El constructor no admite payload ni assessment: la única vía es que el
    // propio flujo invoque al proveedor.
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/custody/integrity/canonical.ts"), "utf8"
    );
    const iface = src.slice(src.indexOf("export interface BuildOutcomeInput"), src.indexOf("/** Cuántas veces"));
    expect(iface).not.toMatch(/providerPayload|assessment\s*:/);
    expect(src).toMatch(/await provider\.compare\(/);
  });

  it.each([
    ["timeout", new DegradedIntegrityVisionProvider("timeout", "x", "authorized-provider")],
    ["excepción", new ThrowingIntegrityVisionProvider("boom")],
    ["payload inválido", new DegradedIntegrityVisionProvider("ok", "x", "authorized-provider")],
  ])("R6-6 · %s → fail-closed, sin modo real falso, una sola invocación", async (_l, provider) => {
    const registry = new ProviderRegistry();
    registry.register(provider, {
      provider: "authorized-provider", model: "m",
      promptVersion: "custody-integrity/v2", executionMode: "real",
    });
    const spy = vi.spyOn(provider, "compare");
    const outcome = await buildEvaluationOutcome({
      caseId: "r6", entity: ENTITY, selector: SELECTOR,
      pair: { ingress: INGRESS, egress: EGRESS },
      provider, registry, verifyChain: chainPort(), evaluatedAt: NOW, now: () => NOW,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(outcomeDiagnostics(outcome)?.providerCalls).toBe(1);
    expect(outcome.state).toBe("REVIEW_REQUIRED");
    expect(outcome.holdReasons).not.toEqual(["NO_CALIBRATED_THRESHOLD"]);
    expect(outcome.assessment.verdict).not.toBe("coincide");
  });

  it("R6-6 · evidencia inválida: cero invocaciones al proveedor", async () => {
    const provider = new MockIntegrityVisionProvider("coincide", "authorized-provider", "real");
    const spy = vi.spyOn(provider, "compare");
    const outcome = await buildEvaluationOutcome({
      caseId: "r6", entity: ENTITY, selector: SELECTOR,
      pair: { ingress: INGRESS, egress: { ...EGRESS, redacted: true } },
      provider, registry: REGISTRY, verifyChain: chainPort(), evaluatedAt: NOW, now: () => NOW,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(outcomeDiagnostics(outcome)?.providerCalls).toBe(0);
    expect(outcome.holdReasons).toContain("EVIDENCE_REDACTED");
  });

  it("R6 · el caso de uso completo invoca al proveedor exactamente una vez", async () => {
    const provider = new MockIntegrityVisionProvider("coincide");
    const spy = vi.spyOn(provider, "compare");
    await evaluateIntegrityCase(evalDeps({ provider }), EVAL_INPUT);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
