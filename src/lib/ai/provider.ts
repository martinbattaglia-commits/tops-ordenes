// F5.2-lite · Abstracción provider-agnostic (D-F5-9; actualizada por Dirección
// 2026-07-03: **GEMINI es el proveedor principal previsto**).
// 'mock' (default) = determinista, sin red, sin secretos.
// 'gemini' = PRINCIPAL, implementado e INERTE hasta ventana de activación
// (fail-closed sin AI_GEMINI_API_KEY/GEMINI_API_KEY).
// 'anthropic' = SECUNDARIO no preferido (implementado, inerte sin key).
// 'openai' = stub deshabilitado. Cambiar de provider = 1 env var, cero código.

import { env } from "@/lib/env";
import type { AiProvider, ProviderTurnRequest, ProviderTurnResponse } from "./types";
import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { MockProvider } from "./providers/mock";

class DisabledProvider implements AiProvider {
  readonly model = "disabled";
  constructor(readonly name: string) {}
  async plan(_req: ProviderTurnRequest): Promise<ProviderTurnResponse> {
    throw new Error(
      `Provider '${this.name}' no habilitado (D-F5-9): requiere aprobación de ` +
        "Dirección. Usá AI_PROVIDER=mock (o anthropic en la ventana de activación)."
    );
  }
}

export function getProvider(): AiProvider {
  switch (env.ai.provider) {
    case "mock":
      return new MockProvider();
    case "gemini":
      // PRINCIPAL. Fail-closed interno: sin key, plan() corta antes de la red.
      return new GeminiProvider();
    case "anthropic":
      // SECUNDARIO no preferido. Mismo fail-closed sin key.
      return new AnthropicProvider();
    case "openai":
      return new DisabledProvider("openai");
    default:
      return new MockProvider();
  }
}
