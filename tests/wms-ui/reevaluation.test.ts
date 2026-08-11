/**
 * WMS · Re-evaluación: composición de confianza y orquestación.
 *
 * Todo inyectado: sin red, sin DB, sin DOM. Lo que se fija acá es que la
 * procedencia la decide el SERVIDOR y que un fallo del proveedor nunca puede
 * terminar habilitando una liberación.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createEvaluationComposition,
  createSandboxVisionProvider,
  runCustodyReevaluation,
  SANDBOX_PROVIDER_NAME,
  type CustodyServerEvaluationPort,
  type ReevaluationDeps,
} from "@/lib/custody/integrity-evaluation";
import { evaluateReleaseEligibility, type EvidenceRecord } from "@/lib/custody/integrity";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function ev(over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: "33333333-3333-4333-8333-333333333333",
    eventId: "44444444-4444-4444-8444-444444444444",
    scope: "shipment",
    entityId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    stage: "packing",
    eventType: "foto_packing",
    kind: "foto",
    sha256: SHA_A,
    capturedAt: "2026-08-08T10:15:00.000Z",
    redacted: false,
    ...over,
  };
}

function deps(
  over: Partial<ReevaluationDeps> = {},
): ReevaluationDeps & { completed: unknown[]; abandoned: string[] } {
  const completed: unknown[] = [];
  const abandoned: string[] = [];
  const server: CustodyServerEvaluationPort = {
    async complete(input) { completed.push(input); },
    async abandon(id) { abandoned.push(id); },
  };
  return Object.assign(
    {
      composition: createEvaluationComposition({ CUSTODY_EVAL_PROVIDER: "sandbox", NODE_ENV: "test" }),
      beginEvaluation: vi.fn(async () => "attempt-1"),
      server,
      now: () => "2026-08-11T12:00:00.000Z",
      ...over,
    },
    { completed, abandoned },
  ) as ReevaluationDeps & { completed: unknown[]; abandoned: string[] };
}

const input = {
  caseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  version: 3,
  state: "REVIEW_REQUIRED",
  ingress: ev(),
  egress: ev({ evidenceId: "55555555-5555-4555-8555-555555555555", stage: "entrega", eventType: "foto_entrega", sha256: SHA_B }),
};

describe("la procedencia la decide la COMPOSICIÓN del servidor", () => {
  it("sin activación explícita, el proveedor no está registrado ⇒ mock", async () => {
    const d = deps({ composition: createEvaluationComposition({}) });
    const out = await runCustodyReevaluation(d, input);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.assessment.provenance.executionMode).toBe("mock");
  });

  it("en PRODUCCIÓN el sandbox nunca acredita, aunque la variable esté puesta", async () => {
    const d = deps({
      composition: createEvaluationComposition({ CUSTODY_EVAL_PROVIDER: "sandbox", NODE_ENV: "production" }),
    });
    const out = await runCustodyReevaluation(d, input);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.assessment.provenance.executionMode).toBe("mock");
  });

  it("una evaluación mock NO habilita liberar", async () => {
    const d = deps({ composition: createEvaluationComposition({}) });
    const out = await runCustodyReevaluation(d, input);
    if (!out.ok) return;
    const e = evaluateReleaseEligibility({
      state: "REVIEW_REQUIRED",
      holdReasons: ["NO_CALIBRATED_THRESHOLD"],
      evidenceOk: true,
      chain: { status: "verified", attestation: { scope: "shipment", entityId: input.ingress.entityId, chainHead: "h", eventsChecked: 3, verifiedEventIds: [], attestedAt: "2026-08-11T11:00:00.000Z" } },
      assessment: out.assessment,
      canonicalInspectionEvidenceIds: ["66666666-6666-4666-8666-666666666666"],
      reason: "inspección física conforme",
    });
    expect(e.allowed).toBe(false);
    expect(e.blockers).toContain("EXECUTION_NOT_REAL");
  });

  it("activado fuera de producción, la ejecución cuenta como real", async () => {
    const d = deps();
    const out = await runCustodyReevaluation(d, input);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.assessment.provenance.executionMode).toBe("real");
    expect(out.assessment.provenance.provider).toBe(SANDBOX_PROVIDER_NAME);
    expect(out.assessment.verdict).toBe("coincide");
    expect(out.assessment.modelConfidence).toBeGreaterThan(0);
  });

  it("el proveedor sandbox es DETERMINISTA para el mismo par", async () => {
    const p = createSandboxVisionProvider();
    const req = { ingress: input.ingress, egress: input.egress, requestedAt: "2026-08-11T12:00:00.000Z" };
    const a = await p.compare(req);
    const b = await p.compare(req);
    expect(a).toEqual(b);
  });
});

describe("una ejecución por intento, y los fallos nunca liberan", () => {
  it("el intento se abre UNA vez y se completa UNA vez", async () => {
    const d = deps();
    await runCustodyReevaluation(d, input);
    expect(d.beginEvaluation).toHaveBeenCalledTimes(1);
    expect(d.completed).toHaveLength(1);
  });

  it("un proveedor que LANZA cierra el intento con outcome, sin propagar el error", async () => {
    const d = deps({
      composition: createEvaluationComposition(
        { CUSTODY_EVAL_PROVIDER: "sandbox", NODE_ENV: "test" },
        createSandboxVisionProvider({ failWith: "threw" }),
      ),
    });
    const out = await runCustodyReevaluation(d, input);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.assessment.outcome).toBe("threw");
    expect(out.assessment.verdict).toBeNull();
    expect(d.completed).toHaveLength(1);
    // El mensaje del proveedor no viaja crudo.
    expect(JSON.stringify(out.assessment)).not.toContain("fallo simulado");
  });

  it("un timeout deja el análisis sin veredicto", async () => {
    const d = deps({
      composition: createEvaluationComposition(
        { CUSTODY_EVAL_PROVIDER: "sandbox", NODE_ENV: "test" },
        createSandboxVisionProvider({ failWith: "timeout" }),
      ),
    });
    const out = await runCustodyReevaluation(d, input);
    if (!out.ok) return;
    expect(out.assessment.outcome).toBe("timeout");
    expect(out.assessment.verdict).toBeNull();
  });

  it("una respuesta inválida se normaliza a invalid_response", async () => {
    const d = deps({
      composition: createEvaluationComposition(
        { CUSTODY_EVAL_PROVIDER: "sandbox", NODE_ENV: "test" },
        createSandboxVisionProvider({ failWith: "invalid_response" }),
      ),
    });
    const out = await runCustodyReevaluation(d, input);
    if (!out.ok) return;
    expect(out.assessment.outcome).toBe("invalid_response");
  });

  it("un caso que no está en revisión NO se evalúa", async () => {
    const d = deps();
    const out = await runCustodyReevaluation(d, { ...input, state: "RELEASED" });
    expect(out).toEqual({ ok: false, error: "STATE_NOT_EVALUABLE" });
    expect(d.beginEvaluation).not.toHaveBeenCalled();
  });

  it("sin las dos fotos no se evalúa", async () => {
    const d = deps();
    const out = await runCustodyReevaluation(d, { ...input, egress: null });
    expect(out).toEqual({ ok: false, error: "EVIDENCE_MISSING" });
    expect(d.beginEvaluation).not.toHaveBeenCalled();
  });

  it("un lease tomado por otro intento no ejecuta al proveedor", async () => {
    const compare = vi.fn();
    const d = deps({
      beginEvaluation: vi.fn(async () => { throw new Error("intento en curso"); }),
      composition: createEvaluationComposition(
        { CUSTODY_EVAL_PROVIDER: "sandbox", NODE_ENV: "test" },
        { descriptor: createSandboxVisionProvider().descriptor, compare },
      ),
    });
    const out = await runCustodyReevaluation(d, input);
    expect(out).toEqual({ ok: false, error: "LEASE_HELD" });
    expect(compare).not.toHaveBeenCalled();
    expect(d.completed).toHaveLength(0);
  });

  it("un conflicto de versión se distingue del lease", async () => {
    const d = deps({
      beginEvaluation: vi.fn(async () => { throw new Error("conflicto de versión"); }),
    });
    const out = await runCustodyReevaluation(d, input);
    expect(out).toEqual({ ok: false, error: "VERSION_CONFLICT" });
  });
});

describe("la reserva es EXCLUSIVA y no deja intentos colgados", () => {
  it("quien pierde la reserva NUNCA llama al proveedor", async () => {
    let llamadas = 0;
    const proveedor = createSandboxVisionProvider();
    const espia = {
      descriptor: proveedor.descriptor,
      async compare(req: Parameters<typeof proveedor.compare>[0]) {
        llamadas += 1;
        return proveedor.compare(req);
      },
    };
    const d = deps({
      composition: createEvaluationComposition(
        { CUSTODY_EVAL_PROVIDER: "sandbox", NODE_ENV: "test" },
        espia,
      ),
      // 0232: con un intento vigente, `begin` levanta excepción.
      beginEvaluation: vi.fn(async () => {
        throw new Error("ya hay una evaluación en curso para este caso");
      }),
    });

    const out = await runCustodyReevaluation(d, input);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("LEASE_HELD");
    // Lo que importa: el análisis no se ejecutó ni una vez.
    expect(llamadas).toBe(0);
    expect(d.completed).toHaveLength(0);
    expect(d.abandoned).toHaveLength(0);
  });

  it("dos solicitudes concurrentes producen UNA sola llamada al proveedor", async () => {
    let llamadas = 0;
    let reservas = 0;
    const proveedor = createSandboxVisionProvider();
    const espia = {
      descriptor: proveedor.descriptor,
      async compare(req: Parameters<typeof proveedor.compare>[0]) {
        llamadas += 1;
        return proveedor.compare(req);
      },
    };
    const composition = createEvaluationComposition(
      { CUSTODY_EVAL_PROVIDER: "sandbox", NODE_ENV: "test" },
      espia,
    );
    // La exclusividad la impone la base: la primera reserva gana, la segunda
    // choca. Acá se modela ese contrato, que es el que 0232 hace cumplir.
    const beginEvaluation = vi.fn(async () => {
      reservas += 1;
      if (reservas > 1) throw new Error("ya hay una evaluación en curso para este caso");
      return "attempt-1";
    });

    const [a, b] = await Promise.all([
      runCustodyReevaluation(deps({ composition, beginEvaluation }), input),
      runCustodyReevaluation(deps({ composition, beginEvaluation }), input),
    ]);

    expect(llamadas).toBe(1);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const perdedor = a.ok ? b : a;
    expect(perdedor.ok).toBe(false);
    if (!perdedor.ok) expect(perdedor.error).toBe("LEASE_HELD");
  });

  it("si no se puede finalizar, el intento se ABANDONA explícitamente", async () => {
    const server: CustodyServerEvaluationPort = {
      async complete() { throw new Error("no se pudo registrar"); },
      async abandon() { /* registrado por el doble de abajo */ },
    };
    const abandonados: string[] = [];
    const d = deps({
      server: {
        complete: server.complete,
        async abandon(id: string) { abandonados.push(id); },
      },
    });

    const out = await runCustodyReevaluation(d, input);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("COMPLETE_FAILED");
    // El caso NO queda trabado esperando el vencimiento del lease.
    expect(abandonados).toEqual(["attempt-1"]);
  });

  it("si tampoco se puede abandonar, se informa el fallo original sin enmascararlo", async () => {
    const d = deps({
      server: {
        async complete() { throw new Error("no se pudo registrar"); },
        async abandon() { throw new Error("tampoco"); },
      },
    });
    const out = await runCustodyReevaluation(d, input);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("COMPLETE_FAILED");
  });

  it("la versión que se finaliza es la de la reserva, sin releerla", async () => {
    const d = deps();
    const out = await runCustodyReevaluation(d, input);
    expect(out.ok).toBe(true);
    expect(d.completed).toHaveLength(1);
    expect((d.completed[0] as { expectedVersion: number }).expectedVersion).toBe(input.version);
  });
});
