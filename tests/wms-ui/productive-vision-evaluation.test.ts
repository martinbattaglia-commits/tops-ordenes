import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  runProductiveCustodyVisionEvaluation,
  type ProductiveVisionBeginRow,
  type ProductiveVisionDeps,
  type ProductiveVisionEvidenceRow,
} from "@/lib/custody/productive-vision-evaluation";
import { CustodyVisionProviderError } from "@/lib/custody/openai-vision-provider";
import {
  CUSTODY_VISION_MODEL,
  CUSTODY_VISION_POLICY_VERSION,
  CUSTODY_VISION_PROMPT_SHA256,
  CUSTODY_VISION_PROMPT_VERSION,
  CUSTODY_VISION_PROVIDER,
  CUSTODY_VISION_SCHEMA_SHA256,
  CUSTODY_VISION_SCHEMA_VERSION,
  CUSTODY_VISION_SCORE_ALGORITHM,
} from "@/lib/custody/openai-vision-contract";

const ATTEMPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POLICY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INGRESS_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EGRESS_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const UNIT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ingressBytes = new Uint8Array([0xff, 0xd8, 0xff, 1]);
const egressBytes = new Uint8Array([0xff, 0xd8, 0xff, 2]);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function begin(over: Partial<ProductiveVisionBeginRow> = {}): ProductiveVisionBeginRow {
  return {
    attempt_id: ATTEMPT,
    disposition: "opened",
    retry_after_seconds: 0,
    case_version: 7,
    ingress_evidence_id: INGRESS_ID,
    egress_evidence_id: EGRESS_ID,
    ingress_sha256: sha(ingressBytes),
    egress_sha256: sha(egressBytes),
    policy_id: POLICY,
    policy_version: CUSTODY_VISION_POLICY_VERSION,
    threshold_percent: 90,
    provider: CUSTODY_VISION_PROVIDER,
    model: CUSTODY_VISION_MODEL,
    prompt_version: CUSTODY_VISION_PROMPT_VERSION,
    prompt_sha256: CUSTODY_VISION_PROMPT_SHA256,
    response_schema_version: CUSTODY_VISION_SCHEMA_VERSION,
    response_schema_sha256: CUSTODY_VISION_SCHEMA_SHA256,
    score_algorithm_version: CUSTODY_VISION_SCORE_ALGORITHM,
    identity_weight: 35,
    packaging_weight: 25,
    quantity_weight: 20,
    condition_weight: 20,
    ...over,
  };
}

function evidence(id: string): ProductiveVisionEvidenceRow {
  const ingress = id === INGRESS_ID;
  const bytes = ingress ? ingressBytes : egressBytes;
  return {
    id,
    physicalUnitId: UNIT,
    stage: ingress ? "recepcion" : "despacho",
    eventType: ingress ? "foto_ingreso" : "foto_egreso",
    bucket: "custody-evidence",
    path: ingress ? "private/in.jpg" : "private/out.jpg",
    mimeType: "image/jpeg",
    sizeBytes: bytes.byteLength,
    sha256: sha(bytes),
    redacted: false,
  };
}

function deps(over: Partial<ProductiveVisionDeps> = {}) {
  const failures: unknown[] = [];
  const completions: unknown[] = [];
  const provider = { compare: vi.fn(async () => ({
    result: {
      identity: 90, packaging: 90, quantity: 90, condition: 90, model_confidence: 0.9,
      verdict: "coincide" as const, packaging_changed: false, missing_items_suspected: false,
      damage_suspected: false, observations: [], zones: [],
    },
    providerResponseId: "resp_test", responseModel: CUSTODY_VISION_MODEL,
    systemFingerprint: null, openaiRequestId: "req_test",
    requestSha256: "1".repeat(64), responseSha256: "2".repeat(64),
  })) };
  const base: ProductiveVisionDeps = {
    session: { begin: vi.fn(async () => [begin()]) },
    server: {
      loadEvidence: vi.fn(async (id) => evidence(id)),
      download: vi.fn(async (_bucket, path) => path.endsWith("in.jpg") ? ingressBytes : egressBytes),
      complete: vi.fn(async (input) => { completions.push(input); return 8; }),
      fail: vi.fn(async (input) => { failures.push(input); return 8; }),
    },
    provider,
    ...over,
  };
  return { base, failures, completions, provider };
}

describe("orquestación productiva de Vision", () => {
  it("recalcula ambos hashes y completa una sola vez", async () => {
    const d = deps();
    await expect(runProductiveCustodyVisionEvaluation(d.base, { caseId: CASE, expectedVersion: 7 }))
      .resolves.toEqual({ status: "completed", attemptId: ATTEMPT, caseVersion: 8 });
    expect(d.provider.compare).toHaveBeenCalledTimes(1);
    expect(d.completions).toHaveLength(1);
    expect(d.failures).toHaveLength(0);
  });

  it.each(["in_flight", "cached", "cooldown"] as const)("%s no descarga ni factura", async (disposition) => {
    const d = deps({ session: { begin: vi.fn(async () => [begin({
      disposition,
      attempt_id: disposition === "cooldown" ? null : ATTEMPT,
      retry_after_seconds: 21,
    })]) } });
    const out = await runProductiveCustodyVisionEvaluation(d.base, { caseId: CASE, expectedVersion: 7 });
    expect(out.status).toBe(disposition);
    expect(d.base.server.download).not.toHaveBeenCalled();
    expect(d.provider.compare).not.toHaveBeenCalled();
  });

  it("drift de política falla antes de descargar", async () => {
    const d = deps({ session: { begin: vi.fn(async () => [begin({ threshold_percent: 89 })]) } });
    const out = await runProductiveCustodyVisionEvaluation(d.base, { caseId: CASE, expectedVersion: 7 });
    expect(out).toMatchObject({ status: "held", failureCode: "POLICY_CONTRACT_MISMATCH" });
    expect(d.base.server.download).not.toHaveBeenCalled();
    expect(d.provider.compare).not.toHaveBeenCalled();
  });

  it("bytes alterados producen HOLD sin llamar OpenAI", async () => {
    const altered = new Uint8Array([0xff, 0xd8, 0xff, 9]);
    const d = deps({ server: {
      ...deps().base.server,
      loadEvidence: vi.fn(async (id) => evidence(id)),
      download: vi.fn(async (_bucket, path) => path.endsWith("in.jpg") ? altered : egressBytes),
      complete: vi.fn(async () => 8),
      fail: vi.fn(async (input) => { d.failures.push(input); return 8; }),
    } });
    const out = await runProductiveCustodyVisionEvaluation(d.base, { caseId: CASE, expectedVersion: 7 });
    expect(out).toMatchObject({ status: "held", failureCode: "EVIDENCE_HASH_MISMATCH" });
    expect(d.provider.compare).not.toHaveBeenCalled();
  });

  it("caída o timeout del proveedor cierran el intento en HOLD", async () => {
    const d = deps();
    d.provider.compare.mockRejectedValueOnce(new CustodyVisionProviderError("PROVIDER_TIMEOUT"));
    const out = await runProductiveCustodyVisionEvaluation(d.base, { caseId: CASE, expectedVersion: 7 });
    expect(out).toMatchObject({ status: "held", failureCode: "PROVIDER_TIMEOUT" });
    expect(d.failures).toHaveLength(1);
    expect(d.completions).toHaveLength(0);
  });

  it("dos ejecuciones contra in_flight sólo permiten una llamada facturable", async () => {
    let calls = 0;
    const d = deps({ session: { begin: vi.fn(async () => {
      calls += 1;
      return [begin(calls === 1 ? {} : { disposition: "in_flight", retry_after_seconds: 60 })];
    }) } });
    const [first, second] = await Promise.all([
      runProductiveCustodyVisionEvaluation(d.base, { caseId: CASE, expectedVersion: 7 }),
      runProductiveCustodyVisionEvaluation(d.base, { caseId: CASE, expectedVersion: 7 }),
    ]);
    expect([first.status, second.status].sort()).toEqual(["completed", "in_flight"]);
    expect(d.provider.compare).toHaveBeenCalledTimes(1);
  });
});
