import type { VoiceEngine, VoiceEngineStartContext } from "../types";

/**
 * Motor en memoria. Permite testear VoiceSession en entorno `node`,
 * sin navegador, sin jsdom y sin dependencias nuevas.
 */
export class FakeVoiceEngine implements VoiceEngine {
  readonly id = "fake";

  readonly capabilities = {
    partialResults: true,
    requiresMediaStream: false,
    providesPunctuation: false,
    locales: "any" as const,
  };

  started = false;
  stopCalls = 0;
  abortCalls = 0;

  /** Si es true, stop() no resuelve nunca: sirve para probar el guard. */
  stopHangs = false;

  private ctx: VoiceEngineStartContext | null = null;

  isAvailable(): boolean {
    return true;
  }

  async start(ctx: VoiceEngineStartContext): Promise<void> {
    this.ctx = ctx;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (this.stopHangs) return new Promise<void>(() => {});
    this.started = false;
  }

  abort(): void {
    this.abortCalls += 1;
    this.started = false;
    this.ctx = null;
  }

  emitPartial(text: string): void {
    this.ctx?.onPartial(text);
  }

  emitFinal(text: string): void {
    this.ctx?.onFinal(text);
  }

  emitError(raw: unknown): void {
    this.ctx?.onError(raw);
  }
}
