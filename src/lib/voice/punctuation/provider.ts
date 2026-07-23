import type { Punctuator, VoiceEngine } from "../types";

/**
 * Confía en la puntuación que entregue el motor. Si el motor no puntúa
 * (Web Speech API no lo hace), degrada a identidad y lo registra una vez.
 */
export function createProviderPunctuator(engine: VoiceEngine): Punctuator {
  if (!engine.capabilities.providesPunctuation) {
    console.warn(
      `[nexus-voice] el motor "${engine.id}" no provee puntuación; ` +
        `punctuationStrategy "provider" degrada a "none".`,
    );
  }
  return { id: "provider", apply: (text) => Promise.resolve(text) };
}
