// F5.2-lite · Abstracción provider-agnostic (D-F5-9).
// 'mock' (default): determinista, sin red, sin secretos — único habilitado.
// 'anthropic'/'openai': stubs que FALLAN con mensaje claro. Activarlos requiere
// aprobación de Dirección (DPA/región/costos) + implementación en ventana
// posterior. Sin SDKs instalados: cero lock-in y cero secretos en esta etapa.

import { env } from "@/lib/env";
import type { AiProvider, ProviderTurnRequest, ProviderTurnResponse } from "./types";
import { MockProvider } from "./providers/mock";

class DisabledProvider implements AiProvider {
  readonly model = "disabled";
  constructor(readonly name: string) {}
  async plan(_req: ProviderTurnRequest): Promise<ProviderTurnResponse> {
    throw new Error(
      `Provider real '${this.name}' no habilitado en F5.2-lite (D-F5-9): ` +
        "requiere aprobación de Dirección (DPA/región/costos). Usá AI_PROVIDER=mock."
    );
  }
}

export function getProvider(): AiProvider {
  switch (env.ai.provider) {
    case "mock":
      return new MockProvider();
    case "anthropic":
    case "openai":
      return new DisabledProvider(env.ai.provider);
    default:
      return new MockProvider();
  }
}
