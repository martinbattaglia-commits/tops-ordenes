// F5.2-lite · Abstracción provider-agnostic (D-F5-9, actualizada por Dirección
// 2026-07-03): 'mock' (default) = determinista, sin red, sin secretos.
// 'anthropic' = implementado pero INERTE hasta la ventana de activación
// (fail-closed sin AI_ANTHROPIC_API_KEY; la key la carga Dirección en Netlify).
// 'openai' = stub deshabilitado. Cambiar de provider = 1 env var, cero código.

import { env } from "@/lib/env";
import type { AiProvider, ProviderTurnRequest, ProviderTurnResponse } from "./types";
import { AnthropicProvider } from "./providers/anthropic";
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
    case "anthropic":
      // Fail-closed interno: sin API key, plan() corta antes de cualquier red.
      return new AnthropicProvider();
    case "openai":
      return new DisabledProvider("openai");
    default:
      return new MockProvider();
  }
}
