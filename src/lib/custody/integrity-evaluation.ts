/**
 * WMS · RE-EVALUACIÓN OPERATIVA DEL CASO DE INTEGRIDAD
 *
 * ─── EL HUECO QUE CIERRA ──────────────────────────────────────────────────
 *
 * Registrar la foto de `inspeccion_humana` agrega un eslabón a la hash-chain,
 * así que la atestación tomada durante la evaluación queda vieja y 0224 bloquea
 * la liberación con «la cadena avanzó desde la atestación». Es correcto: una
 * liberación no puede apoyarse en una verificación anterior a la última
 * evidencia. Lo que faltaba era el camino operativo para rehacerla.
 *
 * ─── CÓMO SE COMPONE LA CONFIANZA ─────────────────────────────────────────
 *
 * La procedencia NO la declara el adaptador: la declara la composición del
 * servidor registrando la INSTANCIA concreta en el `ProviderRegistry`
 * (0223/R3-2). Una instancia no registrada queda `mock`, y una evaluación
 * `mock` no habilita liberar —`EXECUTION_NOT_REAL`—.
 *
 * Por defecto NADA está registrado: sin una activación explícita, la
 * re-evaluación produce una evaluación `mock` y el caso sigue sin poder
 * liberarse. Falla cerrado por omisión, que es lo que corresponde cuando la
 * pregunta es «¿esto lo miró un modelo de verdad?».
 *
 * ─── LÍMITE DE ESTA VENTANA ───────────────────────────────────────────────
 *
 * El proveedor de visión REAL (OpenAI) sigue siendo una activación separada:
 * acá no se implementa ni se llama. Lo único que existe es un proveedor
 * SANDBOX determinista para el harness local.
 */

import { createHash } from "node:crypto";
import {
  buildAssessmentFromIdentity,
  captureProviderIdentity,
  ProviderRegistry,
  PROMPT_VERSION,
  type EvidenceRecord,
  type IntegrityAssessment,
  type IntegrityVisionProvider,
  type ProviderDescriptor,
  type RawProviderPayload,
} from "./integrity";

// ---------------------------------------------------------------------------
// Proveedor SANDBOX determinista
// ---------------------------------------------------------------------------

export const SANDBOX_PROVIDER_NAME = "sandbox-deterministic";

/**
 * Compara dos evidencias sin red y sin modelo: deriva un veredicto estable de
 * los digests ya verificados por el servidor. Es reproducible, no consulta nada
 * externo y jamás toca OpenAI.
 *
 * No pretende ser un análisis: existe para que el flujo operativo pueda
 * ejercitarse extremo a extremo en un entorno controlado.
 */
export function createSandboxVisionProvider(
  opts: { failWith?: "timeout" | "threw" | "invalid_response" } = {},
): IntegrityVisionProvider {
  const descriptor: ProviderDescriptor = {
    name: SANDBOX_PROVIDER_NAME,
    model: "digest-compare-1",
    promptVersion: PROMPT_VERSION,
    // Etiqueta informativa. La procedencia real la fija el registro.
    declaredMode: "mock",
  };
  return {
    descriptor,
    async compare(request): Promise<RawProviderPayload> {
      if (opts.failWith === "threw") throw new Error("proveedor sandbox: fallo simulado");
      if (opts.failWith === "timeout") return { outcome: "timeout", error: "sin respuesta" };
      if (opts.failWith === "invalid_response") return { outcome: "ok", verdict: "no-existe" };

      const a = request.ingress.sha256;
      const b = request.egress.sha256;
      // Determinista y estable: el mismo par siempre da el mismo veredicto.
      const mix = createHash("sha256").update(`${a}:${b}`).digest();
      const confidence = 0.5 + (mix[0] % 50) / 100; // 0.50 … 0.99
      return {
        outcome: "ok",
        verdict: "coincide",
        modelConfidence: Number(confidence.toFixed(3)),
        observations: ["comparación determinista de digests verificados"],
        zones: [],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Composición server-side de la confianza
// ---------------------------------------------------------------------------

export interface EvaluationComposition {
  provider: IntegrityVisionProvider;
  registry: ProviderRegistry;
}

/**
 * Compone el proveedor y decide, EN EL SERVIDOR, si su ejecución cuenta como
 * real.
 *
 * `CUSTODY_EVAL_PROVIDER=sandbox` es una activación EXPLÍCITA y sólo se acepta
 * fuera de producción: en producción el sandbox nunca acredita nada, por más
 * que la variable esté puesta. Sin activación, el proveedor no se registra y su
 * evaluación queda `mock`.
 */
export function createEvaluationComposition(
  env: { CUSTODY_EVAL_PROVIDER?: string; NODE_ENV?: string } = process.env,
  provider: IntegrityVisionProvider = createSandboxVisionProvider(),
): EvaluationComposition {
  const registry = new ProviderRegistry();
  const activado = env.CUSTODY_EVAL_PROVIDER === "sandbox";
  const fueraDeProduccion = env.NODE_ENV !== "production";
  if (activado && fueraDeProduccion) {
    registry.register(provider, {
      provider: provider.descriptor.name,
      model: provider.descriptor.model,
      promptVersion: provider.descriptor.promptVersion,
      // La composición del servidor es la que acredita: el adaptador declara
      // `mock` y no puede promoverse solo.
      executionMode: "real",
    });
  }
  return { provider, registry };
}

// ---------------------------------------------------------------------------
// Puerto server-side de finalización (ROL INTERNO DE SERVIDOR)
// ---------------------------------------------------------------------------

export interface CompleteEvaluationInput {
  attemptId: string;
  caseId: string;
  expectedVersion: number;
  provider: string;
  model: string;
  promptVersion: string;
  executionMode: string;
  outcome: string;
  verdict: string | null;
  modelConfidence: number | null;
  providerError: string | null;
}

/**
 * `complete_custody_integrity_evaluation` (0223) exige el rol interno de
 * servidor. Este puerto existe para que ese privilegio quede confinado a una
 * superficie nombrada, imposible de confundir con el cliente de sesión.
 */
export interface CustodyServerEvaluationPort {
  complete(input: CompleteEvaluationInput): Promise<void>;
  /**
   * Cierra un intento que NO se va a poder finalizar.
   *
   * Existe por la exclusividad de la reserva (0232): desde que un intento
   * pendiente ya no se puede pisar, uno colgado bloquearía el caso hasta que
   * venciera el lease. Abandonarlo explícitamente devuelve el caso a la
   * operación de inmediato, sin registrar ningún resultado.
   */
  abandon(attemptId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

export type ReevaluationError =
  | "STATE_NOT_EVALUABLE"
  | "EVIDENCE_MISSING"
  | "LEASE_HELD"
  | "VERSION_CONFLICT"
  | "COMPLETE_FAILED";

export type ReevaluationResult =
  | { ok: true; assessment: IntegrityAssessment; attemptId: string }
  | { ok: false; error: ReevaluationError };

export interface ReevaluationDeps {
  composition: EvaluationComposition;
  /**
   * Reserva EXCLUSIVA del intento (`begin_…`, 0223 + 0232). Es el punto de
   * serialización: quien no la obtiene no llega a ver al proveedor.
   */
  beginEvaluation(caseId: string, expectedVersion: number): Promise<string>;
  server: CustodyServerEvaluationPort;
  now: () => string;
}

export interface ReevaluationInput {
  caseId: string;
  version: number;
  state: string;
  ingress: EvidenceRecord | null;
  egress: EvidenceRecord | null;
}

/**
 * Ejecuta EXACTAMENTE una evaluación por intento.
 *
 * Un fallo del proveedor no aborta el flujo a mitad de camino: se cierra el
 * intento con el `outcome` que corresponda, de modo que el caso vuelve a
 * `REVIEW_REQUIRED` con una evaluación que NO habilita liberar. Dejar el
 * intento abierto sería peor: bloquearía el caso hasta que venciera el lease.
 */
export async function runCustodyReevaluation(
  deps: ReevaluationDeps,
  input: ReevaluationInput,
): Promise<ReevaluationResult> {
  if (input.state !== "REVIEW_REQUIRED") return { ok: false, error: "STATE_NOT_EVALUABLE" };
  if (!input.ingress || !input.egress) return { ok: false, error: "EVIDENCE_MISSING" };

  let attemptId: string;
  try {
    attemptId = await deps.beginEvaluation(input.caseId, input.version);
  } catch (e) {
    // La reserva es el punto de serialización: dos pedidos simultáneos chocan
    // acá y sólo UNO sigue. El que pierde vuelve sin haber tocado al proveedor,
    // que es lo que hace que dos clics concurrentes produzcan una sola llamada
    // efectiva y no dos análisis facturados. No se reintenta.
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    return {
      ok: false,
      error: msg.includes("versión") || msg.includes("version") ? "VERSION_CONFLICT" : "LEASE_HELD",
    };
  }

  // La identidad se captura ANTES del primer await del proveedor: un registro
  // posterior no puede convertir `mock` en `real`.
  const identity = captureProviderIdentity(deps.composition.provider, deps.composition.registry);
  const requestedAt = deps.now();

  let payload: RawProviderPayload;
  try {
    payload = await deps.composition.provider.compare({
      ingress: input.ingress,
      egress: input.egress,
      requestedAt,
    });
  } catch {
    // El error del proveedor NO se propaga como texto: se convierte en outcome.
    payload = { outcome: "threw", error: "el análisis falló" };
  }

  const assessment = buildAssessmentFromIdentity(identity, payload, requestedAt, deps.now());

  // La versión que exige `complete` es EXACTAMENTE `case_version_at_start`, y
  // `begin` sólo reserva si el caso estaba en `input.version`: son el mismo
  // número. Releerla antes de finalizar no agregaba validación —la comparación
  // vive en la RPC— y sí agregaba un modo de fallo propio.
  try {
    await deps.server.complete({
      attemptId,
      caseId: input.caseId,
      expectedVersion: input.version,
      provider: assessment.provenance.provider,
      model: assessment.provenance.model,
      promptVersion: assessment.provenance.promptVersion,
      executionMode: assessment.provenance.executionMode,
      outcome: assessment.outcome,
      verdict: assessment.verdict,
      modelConfidence: assessment.modelConfidence,
      providerError: assessment.error,
    });
  } catch {
    // No se pudo registrar el resultado: el intento queda cerrado igual, para
    // que la reserva exclusiva no deje el caso trabado hasta vencer el lease.
    // Si tampoco se puede abandonar, se informa el fallo original: no hay nada
    // más honesto que decir, y el vencimiento sigue siendo la red de abajo.
    try {
      await deps.server.abandon(attemptId);
    } catch {
      /* el lease vence solo; no se enmascara el fallo real */
    }
    return { ok: false, error: "COMPLETE_FAILED" };
  }

  return { ok: true, assessment, attemptId };
}
