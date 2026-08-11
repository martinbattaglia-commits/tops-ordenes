/**
 * Puerto del proveedor de comparación visual. Módulo puro.
 *
 * R3-2. La procedencia ya no se deriva de lo que el adaptador dice llamarse:
 * se deriva de la **identidad de la instancia** registrada por la composición
 * server-side (`ProviderRegistry`). Un impostor con el mismo `name` queda
 * `mock`.
 *
 * El resultado se **sella** (R3-1): el repositorio sólo persiste evaluaciones
 * producidas por este flujo, no objetos compuestos por un caller.
 */

import {
  resolveProviderIdentity,
  type ProviderRegistry,
  type TrustedProviderIdentity,
} from "./provider-registry";
import {
  EXECUTION_MODES,
  OUTCOME_VALUES,
  VERDICT_VALUES,
  type EvidenceRecord,
  type ExecutionMode,
  type IntegrityAssessment,
  type IntegrityVerdictKind,
  type ProviderOutcomeKind,
} from "./types";
import { isFiniteInRange, toBoundedStringList, toBoundedText } from "./validation";

export const PROMPT_VERSION = "custody-integrity/v2";

/** Etiqueta declarada por el adaptador. INFORMATIVA: no acredita nada. */
export interface ProviderDescriptor {
  name: string;
  model: string;
  promptVersion: string;
  declaredMode: ExecutionMode;
}

export interface CompareRequest {
  ingress: EvidenceRecord;
  egress: EvidenceRecord;
  requestedAt: string;
}

export interface RawProviderPayload {
  outcome: unknown;
  verdict?: unknown;
  modelConfidence?: unknown;
  observations?: unknown;
  zones?: unknown;
  error?: unknown;
}

export interface IntegrityVisionProvider {
  readonly descriptor: ProviderDescriptor;
  compare(request: CompareRequest): Promise<RawProviderPayload>;
}

function sanitizeDescriptor(d: ProviderDescriptor): ProviderDescriptor {
  return {
    name: toBoundedText(d?.name, 64) ?? "unknown",
    model: toBoundedText(d?.model, 64) ?? "unknown",
    promptVersion: toBoundedText(d?.promptVersion, 64) ?? "unknown",
    declaredMode: (EXECUTION_MODES as readonly string[]).includes(d?.declaredMode)
      ? d.declaredMode
      : "mock",
  };
}

/**
 * Modo efectivo por IDENTIDAD DE INSTANCIA.
 *
 * El descriptor sólo aporta etiquetas de presentación cuando la instancia no
 * está registrada.
 */
export function resolveExecutionMode(
  instance: IntegrityVisionProvider,
  registry: ProviderRegistry
): ExecutionMode {
  const d = sanitizeDescriptor(instance?.descriptor ?? ({} as ProviderDescriptor));
  return resolveProviderIdentity(
    instance,
    { provider: d.name, model: d.model, promptVersion: d.promptVersion },
    registry
  ).executionMode;
}

/**
 * Identidad efectiva de una instancia. Se resuelve UNA sola vez, antes de
 * cualquier `await` (R6-2): un registro posterior no puede convertir `mock` en
 * `real`, ni sustituir la instancia puede cambiar la procedencia.
 */
export function captureProviderIdentity(
  instance: IntegrityVisionProvider,
  registry: ProviderRegistry
): TrustedProviderIdentity {
  const d = sanitizeDescriptor(instance?.descriptor ?? ({} as ProviderDescriptor));
  return Object.freeze(
    resolveProviderIdentity(
      instance,
      { provider: d.name, model: d.model, promptVersion: d.promptVersion },
      registry
    )
  );
}

/**
 * Normaliza el payload crudo usando una identidad YA CAPTURADA.
 *
 * No consulta el registro: la procedencia quedó fijada antes del primer await.
 */
export function buildAssessmentFromIdentity(
  identity: TrustedProviderIdentity,
  payload: RawProviderPayload,
  requestedAt: string,
  completedAt: string | null
): IntegrityAssessment {
  let outcome: ProviderOutcomeKind = (OUTCOME_VALUES as readonly unknown[]).includes(payload?.outcome)
    ? (payload.outcome as ProviderOutcomeKind)
    : "invalid_response";

  let verdict: IntegrityVerdictKind | null = null;
  let modelConfidence: number | null = null;

  if (outcome === "ok") {
    const v = payload.verdict;
    const c = payload.modelConfidence;
    if (typeof v === "string" && (VERDICT_VALUES as readonly string[]).includes(v)) {
      verdict = v as IntegrityVerdictKind;
    } else {
      outcome = "invalid_response";
    }
    if (isFiniteInRange(c, 0, 1)) {
      modelConfidence = c;
    } else {
      outcome = "invalid_response";
      verdict = null;
    }
  }

  return Object.freeze({
    outcome,
    verdict,
    modelConfidence,
    observations: toBoundedStringList(payload?.observations),
    zones: toBoundedStringList(payload?.zones),
    error: toBoundedText(payload?.error),
    provenance: {
      provider: identity.provider,
      model: identity.model,
      promptVersion: identity.promptVersion,
      executionMode: identity.executionMode,
      requestedAt,
      completedAt,
    },
  }) satisfies IntegrityAssessment;
}

/**
 * Compat para pruebas de normalización de payload. NO produce un outcome
 * canónico: `buildEvaluationOutcome` ya no acepta assessments desde afuera.
 */
export function buildAssessment(
  instance: IntegrityVisionProvider,
  payload: RawProviderPayload,
  requestedAt: string,
  completedAt: string | null,
  registry: ProviderRegistry
): IntegrityAssessment {
  return buildAssessmentFromIdentity(
    captureProviderIdentity(instance, registry),
    payload,
    requestedAt,
    completedAt
  );
}
