import type { Punctuator, PunctuationStrategy, VoiceEngine } from "../types";
import { applyCommands } from "./commands";
import { nonePunctuator } from "./none";
import { createProviderPunctuator } from "./provider";

export { applyCommands };

export function resolvePunctuator(
  strategy: PunctuationStrategy,
  engine: VoiceEngine,
): Punctuator {
  switch (strategy) {
    case "none":
      return nonePunctuator;

    case "commands":
      return { id: "commands", apply: (t) => Promise.resolve(applyCommands(t)) };

    case "provider":
      return createProviderPunctuator(engine);

    case "ai":
      // Error del programador, no del usuario: por eso NO es un VoiceError.
      // Nunca debe llegar a la interfaz. Ver spec §7.1.
      throw new Error(
        'punctuationStrategy "ai" no está implementada en Nexus Voice v1. ' +
          "Es una decisión deliberada de producto (spec §7.1), no una limitación técnica.",
      );
  }
}
