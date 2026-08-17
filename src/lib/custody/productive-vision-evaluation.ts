import "server-only";

import { createHash } from "node:crypto";
import {
  CUSTODY_VISION_MODEL,
  CUSTODY_VISION_POLICY_VERSION,
  CUSTODY_VISION_PROMPT_SHA256,
  CUSTODY_VISION_PROMPT_VERSION,
  CUSTODY_VISION_PROVIDER,
  CUSTODY_VISION_SCHEMA_SHA256,
  CUSTODY_VISION_SCHEMA_VERSION,
  CUSTODY_VISION_SCORE_ALGORITHM,
  CUSTODY_VISION_THRESHOLD,
} from "./openai-vision-contract";
import {
  CustodyVisionProviderError,
  type CustodyVisionImage,
  type CustodyVisionMime,
  type CustodyVisionProviderResult,
} from "./openai-vision-provider";

export type ProductiveVisionFailureCode =
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_REDACTED"
  | "EVIDENCE_SIZE_MISMATCH"
  | "EVIDENCE_MIME_MISMATCH"
  | "EVIDENCE_HASH_MISMATCH"
  | "EVIDENCE_DOWNLOAD_FAILED"
  | "POLICY_CONTRACT_MISMATCH"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_INVALID_RESPONSE";

export interface ProductiveVisionBeginRow {
  attempt_id: string | null;
  disposition: "opened" | "in_flight" | "cached" | "cooldown";
  retry_after_seconds: number;
  case_version: number;
  ingress_evidence_id: string;
  egress_evidence_id: string;
  ingress_sha256: string;
  egress_sha256: string;
  policy_id: string;
  policy_version: string;
  threshold_percent: number;
  provider: string;
  model: string;
  prompt_version: string;
  prompt_sha256: string;
  response_schema_version: string;
  response_schema_sha256: string;
  score_algorithm_version: string;
  identity_weight: number;
  packaging_weight: number;
  quantity_weight: number;
  condition_weight: number;
}

export interface ProductiveVisionEvidenceRow {
  id: string;
  physicalUnitId: string;
  stage: "recepcion" | "despacho";
  eventType: "foto_ingreso" | "foto_egreso";
  bucket: string;
  path: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string;
  redacted: boolean;
}

export interface ProductiveVisionSessionPort {
  begin(caseId: string, expectedVersion: number): Promise<unknown>;
}

export interface ProductiveVisionServerPort {
  loadEvidence(evidenceId: string): Promise<ProductiveVisionEvidenceRow | null>;
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  complete(input: {
    attemptId: string;
    caseId: string;
    expectedVersion: number;
    ingressObservedSha256: string;
    egressObservedSha256: string;
    provider: CustodyVisionProviderResult;
  }): Promise<number>;
  fail(input: {
    attemptId: string;
    caseId: string;
    expectedVersion: number;
    failureCode: ProductiveVisionFailureCode;
    ingressObservedSha256: string | null;
    egressObservedSha256: string | null;
  }): Promise<number>;
}

export interface ProductiveVisionProviderPort {
  compare(ingress: CustodyVisionImage, egress: CustodyVisionImage): Promise<CustodyVisionProviderResult>;
}

export interface ProductiveVisionDeps {
  session: ProductiveVisionSessionPort;
  server: ProductiveVisionServerPort;
  provider: ProductiveVisionProviderPort;
}

export type ProductiveVisionRunResult =
  | { status: "completed"; attemptId: string; caseVersion: number }
  | { status: "held"; attemptId: string; caseVersion: number; failureCode: ProductiveVisionFailureCode }
  | { status: "in_flight" | "cached" | "cooldown"; attemptId: string | null; retryAfterSeconds: number };

export class ProductiveVisionEvaluationError extends Error {
  constructor(readonly code: "BEGIN_CONTRACT_INVALID" | "SERVER_FINALIZATION_FAILED") {
    super(code);
    this.name = "ProductiveVisionEvaluationError";
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseBegin(raw: unknown): ProductiveVisionBeginRow | null {
  if (!Array.isArray(raw) || raw.length !== 1 || typeof raw[0] !== "object" || raw[0] === null) return null;
  const row = raw[0] as Record<string, unknown>;
  const disposition = row.disposition;
  if (disposition !== "opened" && disposition !== "in_flight"
      && disposition !== "cached" && disposition !== "cooldown") return null;
  const attemptId = row.attempt_id;
  if (attemptId !== null && (typeof attemptId !== "string" || !UUID_RE.test(attemptId))) return null;
  if ((disposition === "opened" || disposition === "in_flight" || disposition === "cached") && attemptId === null) return null;

  const requiredStrings = [
    "ingress_evidence_id", "egress_evidence_id", "ingress_sha256", "egress_sha256", "policy_id",
    "policy_version", "provider", "model", "prompt_version", "prompt_sha256",
    "response_schema_version", "response_schema_sha256", "score_algorithm_version",
  ] as const;
  if (requiredStrings.some((key) => typeof row[key] !== "string" || row[key] === "")) return null;
  if (!UUID_RE.test(row.ingress_evidence_id as string) || !UUID_RE.test(row.egress_evidence_id as string)
      || !UUID_RE.test(row.policy_id as string) || !SHA256_RE.test(row.ingress_sha256 as string)
      || !SHA256_RE.test(row.egress_sha256 as string) || !SHA256_RE.test(row.prompt_sha256 as string)
      || !SHA256_RE.test(row.response_schema_sha256 as string)) return null;

  const numbers = [
    "retry_after_seconds", "case_version", "threshold_percent", "identity_weight",
    "packaging_weight", "quantity_weight", "condition_weight",
  ] as const;
  const parsed = Object.fromEntries(numbers.map((key) => [key, numeric(row[key])])) as Record<typeof numbers[number], number | null>;
  if (numbers.some((key) => parsed[key] === null)) return null;
  if (!Number.isInteger(parsed.case_version) || parsed.case_version! <= 0
      || !Number.isInteger(parsed.retry_after_seconds) || parsed.retry_after_seconds! < 0) return null;

  return {
    attempt_id: attemptId as string | null,
    disposition,
    retry_after_seconds: parsed.retry_after_seconds!,
    case_version: parsed.case_version!,
    ingress_evidence_id: row.ingress_evidence_id as string,
    egress_evidence_id: row.egress_evidence_id as string,
    ingress_sha256: row.ingress_sha256 as string,
    egress_sha256: row.egress_sha256 as string,
    policy_id: row.policy_id as string,
    policy_version: row.policy_version as string,
    threshold_percent: parsed.threshold_percent!,
    provider: row.provider as string,
    model: row.model as string,
    prompt_version: row.prompt_version as string,
    prompt_sha256: row.prompt_sha256 as string,
    response_schema_version: row.response_schema_version as string,
    response_schema_sha256: row.response_schema_sha256 as string,
    score_algorithm_version: row.score_algorithm_version as string,
    identity_weight: parsed.identity_weight!,
    packaging_weight: parsed.packaging_weight!,
    quantity_weight: parsed.quantity_weight!,
    condition_weight: parsed.condition_weight!,
  };
}

function policyMatches(row: ProductiveVisionBeginRow): boolean {
  return row.policy_version === CUSTODY_VISION_POLICY_VERSION
    && row.threshold_percent === CUSTODY_VISION_THRESHOLD
    && row.provider === CUSTODY_VISION_PROVIDER
    && row.model === CUSTODY_VISION_MODEL
    && row.prompt_version === CUSTODY_VISION_PROMPT_VERSION
    && row.prompt_sha256 === CUSTODY_VISION_PROMPT_SHA256
    && row.response_schema_version === CUSTODY_VISION_SCHEMA_VERSION
    && row.response_schema_sha256 === CUSTODY_VISION_SCHEMA_SHA256
    && row.score_algorithm_version === CUSTODY_VISION_SCORE_ALGORITHM
    && row.identity_weight === 35
    && row.packaging_weight === 25
    && row.quantity_weight === 20
    && row.condition_weight === 20;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sniffCustodyVisionMime(bytes: Uint8Array): CustodyVisionMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
      && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a
      && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46
      && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45
      && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

interface VerifiedImage {
  image: CustodyVisionImage;
  sha256: string;
}

async function verifyEvidence(
  server: ProductiveVisionServerPort,
  id: string,
  expectedSha256: string,
  expectedStage: ProductiveVisionEvidenceRow["stage"],
  expectedEvent: ProductiveVisionEvidenceRow["eventType"],
): Promise<{ verified: VerifiedImage | null; failure: ProductiveVisionFailureCode | null }> {
  const row = await server.loadEvidence(id);
  if (!row || row.id !== id) return { verified: null, failure: "EVIDENCE_NOT_FOUND" };
  if (row.redacted) return { verified: null, failure: "EVIDENCE_REDACTED" };
  if (!row.physicalUnitId || row.stage !== expectedStage || row.eventType !== expectedEvent
      || row.bucket !== "custody-evidence" || row.sha256 !== expectedSha256) {
    return { verified: null, failure: "EVIDENCE_NOT_FOUND" };
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await server.download(row.bucket, row.path);
  } catch {
    bytes = null;
  }
  if (!bytes) return { verified: null, failure: "EVIDENCE_DOWNLOAD_FAILED" };
  if (!Number.isInteger(row.sizeBytes) || row.sizeBytes! < 1 || row.sizeBytes! > 8_388_608
      || bytes.byteLength !== row.sizeBytes) return { verified: null, failure: "EVIDENCE_SIZE_MISMATCH" };
  const mimeType = sniffCustodyVisionMime(bytes);
  if (!mimeType || mimeType !== row.mimeType) return { verified: null, failure: "EVIDENCE_MIME_MISMATCH" };
  const sha256 = digest(bytes);
  if (sha256 !== expectedSha256 || sha256 !== row.sha256) {
    return { verified: { image: { bytes, mimeType }, sha256 }, failure: "EVIDENCE_HASH_MISMATCH" };
  }
  return { verified: { image: { bytes, mimeType }, sha256 }, failure: null };
}

async function hold(
  deps: ProductiveVisionDeps,
  row: ProductiveVisionBeginRow,
  caseId: string,
  failureCode: ProductiveVisionFailureCode,
  ingressObservedSha256: string | null,
  egressObservedSha256: string | null,
): Promise<ProductiveVisionRunResult> {
  if (!row.attempt_id) throw new ProductiveVisionEvaluationError("BEGIN_CONTRACT_INVALID");
  try {
    const caseVersion = await deps.server.fail({
      attemptId: row.attempt_id,
      caseId,
      expectedVersion: row.case_version,
      failureCode,
      ingressObservedSha256,
      egressObservedSha256,
    });
    return { status: "held", attemptId: row.attempt_id, caseVersion, failureCode };
  } catch {
    throw new ProductiveVisionEvaluationError("SERVER_FINALIZATION_FAILED");
  }
}

export type InspectionIntegrityFailure =
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_REDACTED"
  | "EVIDENCE_DOWNLOAD_FAILED"
  | "EVIDENCE_SIZE_MISMATCH"
  | "EVIDENCE_MIME_MISMATCH"
  | "EVIDENCE_HASH_MISMATCH";

export type InspectionIntegrityResult =
  | { ok: true }
  | { ok: false; evidenceId: string; failure: InspectionIntegrityFailure };

/**
 * Re-verifica los BYTES de la evidencia de inspección humana contra su digest
 * registrado, inmediatamente antes de decidir.
 *
 * Por qué hace falta: el par ingreso/egreso se re-descarga y se re-hashea al
 * evaluar, pero la foto de inspección no se re-hasheaba en ningún punto, y el
 * certificado de liberación se emitía sobre datos de fila. La policy de UPDATE
 * de Storage (0037) admite a los mismos roles que capturan, así que un objeto
 * podía reemplazarse después de registrado y el certificado terminaba
 * atestiguando bytes que ya no estaban. Postgres no puede leer Storage: la
 * comprobación tiene que vivir acá, del lado del servidor, con service role.
 *
 * Falla CERRADO: cualquier duda —no está, fue redactada, no se puede bajar, el
 * tamaño no da, el tipo real no coincide o el digest cambió— impide decidir.
 */
export async function verifyInspectionEvidenceIntegrity(
  server: Pick<ProductiveVisionServerPort, "loadEvidence" | "download">,
  evidenceIds: readonly string[],
): Promise<InspectionIntegrityResult> {
  for (const id of evidenceIds) {
    const row = await server.loadEvidence(id);
    if (!row || row.id !== id) return { ok: false, evidenceId: id, failure: "EVIDENCE_NOT_FOUND" };
    if (row.redacted) return { ok: false, evidenceId: id, failure: "EVIDENCE_REDACTED" };

    let bytes: Uint8Array | null;
    try {
      bytes = await server.download(row.bucket, row.path);
    } catch {
      bytes = null;
    }
    if (!bytes) return { ok: false, evidenceId: id, failure: "EVIDENCE_DOWNLOAD_FAILED" };

    if (!Number.isInteger(row.sizeBytes) || row.sizeBytes! < 1
        || row.sizeBytes! > 8_388_608 || bytes.byteLength !== row.sizeBytes) {
      return { ok: false, evidenceId: id, failure: "EVIDENCE_SIZE_MISMATCH" };
    }
    const mimeType = sniffCustodyVisionMime(bytes);
    if (!mimeType || mimeType !== row.mimeType) {
      return { ok: false, evidenceId: id, failure: "EVIDENCE_MIME_MISMATCH" };
    }
    if (digest(bytes) !== row.sha256) {
      return { ok: false, evidenceId: id, failure: "EVIDENCE_HASH_MISMATCH" };
    }
  }
  return { ok: true };
}

export async function runProductiveCustodyVisionEvaluation(
  deps: ProductiveVisionDeps,
  input: { caseId: string; expectedVersion: number },
): Promise<ProductiveVisionRunResult> {
  const row = parseBegin(await deps.session.begin(input.caseId, input.expectedVersion));
  if (!row || row.case_version !== input.expectedVersion) {
    throw new ProductiveVisionEvaluationError("BEGIN_CONTRACT_INVALID");
  }
  if (row.disposition !== "opened") {
    return { status: row.disposition, attemptId: row.attempt_id, retryAfterSeconds: row.retry_after_seconds };
  }
  if (!policyMatches(row)) {
    return hold(deps, row, input.caseId, "POLICY_CONTRACT_MISMATCH", null, null);
  }

  const ingress = await verifyEvidence(
    deps.server, row.ingress_evidence_id, row.ingress_sha256, "recepcion", "foto_ingreso",
  );
  if (ingress.failure) {
    return hold(deps, row, input.caseId, ingress.failure, ingress.verified?.sha256 ?? null, null);
  }
  const egress = await verifyEvidence(
    deps.server, row.egress_evidence_id, row.egress_sha256, "despacho", "foto_egreso",
  );
  if (egress.failure) {
    return hold(
      deps, row, input.caseId, egress.failure, ingress.verified!.sha256, egress.verified?.sha256 ?? null,
    );
  }
  if (ingress.verified!.sha256 === egress.verified!.sha256) {
    return hold(
      deps, row, input.caseId, "EVIDENCE_HASH_MISMATCH", ingress.verified!.sha256, egress.verified!.sha256,
    );
  }

  let provider: CustodyVisionProviderResult;
  try {
    provider = await deps.provider.compare(ingress.verified!.image, egress.verified!.image);
  } catch (error) {
    const failureCode = error instanceof CustodyVisionProviderError
      ? error.code
      : "PROVIDER_UNAVAILABLE";
    return hold(
      deps, row, input.caseId, failureCode, ingress.verified!.sha256, egress.verified!.sha256,
    );
  }

  try {
    const caseVersion = await deps.server.complete({
      attemptId: row.attempt_id!,
      caseId: input.caseId,
      expectedVersion: row.case_version,
      ingressObservedSha256: ingress.verified!.sha256,
      egressObservedSha256: egress.verified!.sha256,
      provider,
    });
    return { status: "completed", attemptId: row.attempt_id!, caseVersion };
  } catch {
    throw new ProductiveVisionEvaluationError("SERVER_FINALIZATION_FAILED");
  }
}
