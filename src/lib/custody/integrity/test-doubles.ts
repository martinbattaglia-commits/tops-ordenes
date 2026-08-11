/**
 * Dobles de prueba y adaptadores de sandbox.
 *
 * DELIBERADAMENTE FUERA DEL BARREL PÚBLICO (`index.ts`). Un repositorio en
 * memoria y un proveedor sintético no son API del módulo: exportarlos junto a
 * los casos de uso invitaba a usarlos como vía alternativa. Quien los necesita
 * los importa explícitamente desde esta ruta.
 */

import type {
  CompareRequest,
  IntegrityVisionProvider,
  ProviderDescriptor,
  RawProviderPayload,
} from "./provider";
import { PROMPT_VERSION } from "./provider";
import type {
  ExecutionMode,
  IntegrityVerdictKind,
  ProviderOutcomeKind,
} from "./types";
import { VERDICT_VALUES } from "./types";

/** Hash determinista y estable (FNV-1a 32 bits). */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Adaptador sintético determinista. */
export class MockIntegrityVisionProvider implements IntegrityVisionProvider {
  readonly descriptor: ProviderDescriptor;

  constructor(
    private readonly forced?: IntegrityVerdictKind,
    name = "mock",
    declaredMode: ExecutionMode = "mock"
  ) {
    this.descriptor = {
      name,
      model: "synthetic-deterministic",
      promptVersion: PROMPT_VERSION,
      declaredMode,
    };
  }

  async compare(request: CompareRequest): Promise<RawProviderPayload> {
    const seed = fnv1a(`${request.ingress.sha256}|${request.egress.sha256}`);
    const verdict = this.forced ?? VERDICT_VALUES[seed % VERDICT_VALUES.length];
    return {
      outcome: "ok",
      verdict,
      modelConfidence: Number((0.5 + (seed % 500) / 1000).toFixed(3)),
      observations: ["Evaluación sintética de sandbox. Sin valor probatorio."],
      zones: verdict === "posible_dano" ? ["zona sintética"] : [],
    };
  }
}

/** Proveedor degradado explícito. Admite un `outcome` arbitrario para pruebas. */
export class DegradedIntegrityVisionProvider implements IntegrityVisionProvider {
  readonly descriptor: ProviderDescriptor;

  constructor(
    private readonly outcome: Exclude<ProviderOutcomeKind, "ok"> | string,
    private readonly message: string,
    name = "degraded"
  ) {
    this.descriptor = { name, model: "n/a", promptVersion: PROMPT_VERSION, declaredMode: "mock" };
  }

  async compare(request: CompareRequest): Promise<RawProviderPayload> {
    void request;
    return { outcome: this.outcome, error: this.message };
  }
}

/** Proveedor que lanza: el caso de uso debe capturarlo y persistir la retención. */
export class ThrowingIntegrityVisionProvider implements IntegrityVisionProvider {
  readonly descriptor: ProviderDescriptor = {
    name: "throwing",
    model: "n/a",
    promptVersion: PROMPT_VERSION,
    declaredMode: "mock",
  };

  constructor(private readonly message = "proveedor caído") {}

  async compare(request: CompareRequest): Promise<RawProviderPayload> {
    void request;
    throw new Error(this.message);
  }
}

/** Default fuera del sandbox: no ejecuta. Retener es preferible a inventar. */
export class NotExecutedVisionProvider implements IntegrityVisionProvider {
  readonly descriptor: ProviderDescriptor = {
    name: "not-executed",
    model: "n/a",
    promptVersion: PROMPT_VERSION,
    declaredMode: "mock",
  };

  async compare(request: CompareRequest): Promise<RawProviderPayload> {
    void request;
    return { outcome: "not_executed", error: "EXTERNAL AI CALL NOT AUTHORIZED" };
  }
}

export { InMemoryIntegrityCaseRepository } from "./in-memory-repository";
