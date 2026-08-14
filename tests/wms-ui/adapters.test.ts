/**
 * WMS UI-1 · Adaptadores productivos con dependencias INYECTADAS.
 *
 * El `CustodyQueryPort` se sustituye por un doble que cuenta llamadas, así que
 * se prueba la traducción y la frontera de tenant sin red, sin DB y sin DOM.
 */
import { describe, expect, it } from "vitest";
import {
  buildIntegrityCase,
  classifyDecideFailure,
  createActorAuthorizationPort,
  createChainHeadPort,
  createEvidenceLoaderPort,
  createIntegrityCaseRepository,
  CustodyContractError,
  mapEvidenceRow,
  type CustodyQueryPort,
  type DecideRpcInput,
  type RawCaseRow,
  type RawDecisionRow,
  type RawEvidenceRow,
} from "@/lib/custody/integrity-adapters";

const CLIENT = "22222222-2222-4222-8222-222222222222";
const SHIPMENT = "11111111-1111-4111-8111-111111111111";
const CASE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ING = "33333333-3333-4333-8333-333333333333";
const EGR = "44444444-4444-4444-8444-444444444444";
const SHA = "a".repeat(64);

function caseRow(over: Partial<RawCaseRow> = {}): RawCaseRow {
  return {
    id: CASE,
    version: 3,
    client_id: CLIENT,
    packing_unit_id: null,
    shipment_id: SHIPMENT,
    state: "REVIEW_REQUIRED",
    hold_reasons: ["NO_CALIBRATED_THRESHOLD"],
    ingress_evidence_id: ING,
    egress_evidence_id: EGR,
    provider: "prov",
    model: "m1",
    prompt_version: "v1",
    execution_mode: "real",
    outcome: "ok",
    verdict: "coincide",
    model_confidence: "0.870",
    provider_error: null,
    chain_status: "verified",
    chain_events_checked: 4,
    chain_head: "head-1",
    chain_attested_at: "2026-08-10T11:30:00.000Z",
    decision_id: null,
    created_at: "2026-08-08T10:15:00.000Z",
    updated_at: "2026-08-10T09:42:00.000Z",
    ...over,
  };
}

function evidenceRow(id: string, over: Partial<RawEvidenceRow> = {}): RawEvidenceRow {
  return {
    id,
    event_id: `${id}-evt`,
    kind: "foto",
    sha256: SHA,
    redacted: false,
    captured_at: "2026-08-08T10:15:00.000Z",
    event: {
      packing_unit_id: null,
      shipment_id: SHIPMENT,
      stage: "packing",
      event_type: "foto_packing",
      occurred_at: "2026-08-08T10:15:00.000Z",
    },
    ...over,
  };
}

interface Spy extends CustodyQueryPort {
  decides: DecideRpcInput[];
  selects: string[];
}

function queryDouble(over: Partial<CustodyQueryPort> = {}, row: RawCaseRow | null = caseRow()): Spy {
  const decides: DecideRpcInput[] = [];
  const selects: string[] = [];
  const base: CustodyQueryPort = {
    async selectCase(id) { selects.push(id); return row; },
    async selectDecision(): Promise<RawDecisionRow | null> { return null; },
    async selectEvidence(ids) { return ids.map((i) => evidenceRow(i)); },
    async verifyChainHead() { return "head-1"; },
    async selectProfile() { return { role: "admin", clientId: null }; },
    async selectPermissions() { return ["wms.custody.decide"]; },
    async decide(input) { decides.push(input); return "decision-1"; },
    async beginEvaluation() { return "attempt-1"; },
    async selectInspectionCandidates() { return ["66666666-6666-4666-8666-666666666666"]; },
    async selectActiveAttempt() { return null; },
  };
  return Object.assign(base, over, { decides, selects }) as Spy;
}

describe("traducción de filas a dominio", () => {
  it("mapEvidenceRow deriva scope/entidad del evento y normaliza el soporte", () => {
    const rec = mapEvidenceRow(evidenceRow(ING), CLIENT);
    expect(rec).not.toBeNull();
    expect(rec!.scope).toBe("shipment");
    expect(rec!.entityId).toBe(SHIPMENT);
    expect(rec!.clientId).toBe(CLIENT);
    expect(rec!.kind).toBe("foto");
  });

  it("un soporte desconocido se normaliza a null en vez de colarse", () => {
    const rec = mapEvidenceRow(evidenceRow(ING, { kind: "video" }), CLIENT);
    expect(rec!.kind).toBeNull();
  });

  it("una evidencia sin evento NO se completa con supuestos", () => {
    expect(mapEvidenceRow(evidenceRow(ING, { event: null }), CLIENT)).toBeNull();
  });

  it("un estado desconocido NO se degrada a algo decidible", async () => {
    const q = queryDouble({}, caseRow({ state: "LO_QUE_SEA" }));
    const c = await buildIntegrityCase(q, caseRow({ state: "LO_QUE_SEA" }));
    expect(c.state).toBe("PENDING_EVIDENCE");
  });

  it("una atestación 'verified' incompleta se degrada a no verificable", async () => {
    const row = caseRow({ chain_status: "verified", chain_head: null });
    const c = await buildIntegrityCase(queryDouble({}, row), row);
    expect(c.chain?.status).toBe("unverifiable");
  });

  it("la confianza numérica llega como número aunque la DB la envíe como texto", async () => {
    const c = await buildIntegrityCase(queryDouble(), caseRow());
    expect(c.assessment?.modelConfidence).toBeCloseTo(0.87, 3);
  });
});

describe("frontera de tenant e identidad", () => {
  it("findById NO devuelve un caso de otro cliente aunque la fila llegue", async () => {
    const repo = createIntegrityCaseRepository(queryDouble());
    const found = await repo.findById(CASE, "99999999-9999-4999-8999-999999999999");
    expect(found).toBeNull();
  });

  it("el actor sale del perfil; un rol interno opera sobre el tenant del CASO", async () => {
    const port = createActorAuthorizationPort(
      queryDouble(),
      { actorId: "u-1", sessionId: "s-1" },
      CLIENT,
    );
    const actor = await port.resolveActor();
    expect(actor?.clientId).toBe(CLIENT);
    expect(actor?.role).toBe("admin");
    expect(actor?.subjectType).toBe("human_session");
  });

  it("un usuario client-bound conserva SU tenant, no el del caso", async () => {
    const port = createActorAuthorizationPort(
      queryDouble({ async selectProfile() { return { role: "cliente", clientId: "otro-cliente" }; } }),
      { actorId: "u-1", sessionId: "s-1" },
      CLIENT,
    );
    const actor = await port.resolveActor();
    expect(actor?.clientId).toBe("otro-cliente");
  });

  it("sin identidad verificada no hay actor", async () => {
    const port = createActorAuthorizationPort(queryDouble(), null, CLIENT);
    expect(await port.resolveActor()).toBeNull();
  });

  it("sin perfil/rol no hay actor", async () => {
    const port = createActorAuthorizationPort(
      queryDouble({ async selectProfile() { return null; } }),
      { actorId: "u-1", sessionId: "s-1" },
      CLIENT,
    );
    expect(await port.resolveActor()).toBeNull();
  });
});

describe("decisión: la DB es la autoridad", () => {
  it("applyDecision delega en la RPC con el CAS de versión", async () => {
    const q = queryDouble();
    const repo = createIntegrityCaseRepository(q);
    const res = await repo.applyDecision({
      caseId: CASE,
      clientId: CLIENT,
      expectedVersion: 3,
      expectedState: "REVIEW_REQUIRED",
      newState: "QUARANTINED",
      updatedAt: "2026-08-10T12:00:00.000Z",
      currentChainHead: "head-1",
      inspectionProof: { ok: true, problems: [], evidenceIds: [] },
      boundTo: "x",
      record: {
        decision: "quarantine",
        actorUserId: "u-1",
        actorSessionId: "s-1",
        actorRole: "operaciones",
        clientId: CLIENT,
        permission: "wms.custody.decide",
        decidedAt: "2026-08-10T12:00:00.000Z",
        reason: "diferencias visibles",
        observations: null,
        inspectionEvidenceIds: [],
        previousState: "REVIEW_REQUIRED",
        newState: "QUARANTINED",
        chainHeadAtDecision: "head-1",
      },
    });
    expect(res.ok).toBe(true);
    expect(q.decides).toHaveLength(1);
    expect(q.decides[0].expectedVersion).toBe(3);
    expect(q.decides[0].decision).toBe("quarantine");
  });

  it("un conflicto de versión se traduce a VERSION_CONFLICT", () => {
    expect(classifyDecideFailure("conflicto de versión del caso")).toEqual({
      ok: false,
      failure: "VERSION_CONFLICT",
    });
  });

  it("un motivo desconocido NO se afirma como inexistente", () => {
    expect(classifyDecideFailure("algo raro")).toEqual({ ok: false, failure: "RECORD_INCOHERENT" });
  });

  it("registrar la evaluación exige el rol interno de servidor y no se simula", async () => {
    const repo = createIntegrityCaseRepository(queryDouble());
    await expect(
      repo.recordAssessment({
        caseId: CASE,
        clientId: CLIENT,
        expectedVersion: 1,
        updatedAt: "2026-08-10T12:00:00.000Z",
        outcome: {} as never,
        boundTo: "x",
      }),
    ).rejects.toBeInstanceOf(CustodyContractError);
  });
});

describe("puertos de evidencia y cadena", () => {
  it("loadPair sin los dos ids no inventa nada", async () => {
    const loader = createEvidenceLoaderPort(queryDouble());
    const pair = await loader.loadPair({
      clientId: CLIENT,
      scope: "shipment",
      entityId: SHIPMENT,
      selector: { ingressEvidenceId: ING, egressEvidenceId: null },
    });
    expect(pair).toEqual({ ingress: null, egress: null });
  });

  it("loadInspectionEvidence descarta filas sin evento", async () => {
    const loader = createEvidenceLoaderPort(
      queryDouble({ async selectEvidence(ids) { return ids.map((i) => evidenceRow(i, { event: null })); } }),
    );
    const rows = await loader.loadInspectionEvidence({
      clientId: CLIENT,
      scope: "shipment",
      entityId: SHIPMENT,
      evidenceIds: [ING],
    });
    expect(rows).toEqual([]);
  });

  it("el head de cadena sale del servidor", async () => {
    const port = createChainHeadPort(queryDouble());
    expect(await port.currentChainHead("shipment", SHIPMENT)).toBe("head-1");
  });
});
