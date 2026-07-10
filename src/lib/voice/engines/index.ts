import type { VoiceEngine } from "../types";
import { createWebSpeechEngine } from "./web-speech";

export { createWebSpeechEngine };

/** Devuelve el motor disponible, o null si el navegador no soporta ninguno. */
export function resolveEngine(): VoiceEngine | null {
  const webSpeech = createWebSpeechEngine();
  return webSpeech.isAvailable() ? webSpeech : null;
}

export function isVoiceSupported(): boolean {
  return resolveEngine() !== null;
}
