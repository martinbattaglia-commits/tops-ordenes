/** Los cuatro estados oficiales. No se agregan estados intermedios. */
export type VoiceState = "idle" | "listening" | "processing" | "error";

export type VoiceAction =
  | { type: "START" }
  | { type: "STOP" }
  | { type: "CANCEL" }
  | { type: "SETTLED" }
  | { type: "FAIL" }
  | { type: "DISMISS" };

export type PunctuationStrategy = "none" | "provider" | "commands" | "ai";

export interface Punctuator {
  readonly id: PunctuationStrategy;
  apply(text: string): Promise<string>;
}

export interface VoiceEngineCapabilities {
  /** ¿Emite texto mientras el usuario habla? */
  partialResults: boolean;
  /** ¿Consume el MediaStream que abre la sesión, o abre el suyo? */
  requiresMediaStream: boolean;
  /** ¿Devuelve texto ya puntuado? */
  providesPunctuation: boolean;
  locales: readonly string[] | "any";
}

export interface VoiceEngineStartContext {
  locale: string;
  /** Provisto por la sesión. Los motores que no lo necesitan lo ignoran. */
  stream: MediaStream | null;
  onPartial(text: string): void;
  /** Un motor continuo emite varios segmentos finales. La sesión los acumula. */
  onFinal(text: string): void;
  onError(error: unknown): void;
}

export interface VoiceEngine {
  readonly id: string;
  readonly capabilities: VoiceEngineCapabilities;
  isAvailable(): boolean;
  start(ctx: VoiceEngineStartContext): Promise<void>;
  /** Corte amable: esperar el resultado final. */
  stop(): Promise<void>;
  /** Corte duro: descartar. */
  abort(): void;
}

export interface VoiceMeter {
  onLevel(cb: (rms: number) => void): () => void;
  stop(): void;
}

export type VoiceMeterFactory = (stream: MediaStream) => VoiceMeter;

export interface VoiceSessionEvents {
  state: (state: VoiceState) => void;
  /** Crudo, sin normalizar. NUNCA toca el campo. */
  partial: (text: string) => void;
  level: (rms: number) => void;
  /** Puntuado + normalizado. Se emite ANTES de la transición a idle. */
  final: (text: string) => void;
  error: (error: VoiceErrorLike) => void;
}

/** Estructura mínima de un error de voz, para evitar un ciclo de imports. */
export interface VoiceErrorLike extends Error {
  readonly code: string;
}

export interface VoiceSessionOptions {
  /** Por defecto "es-AR". */
  locale?: string;
  engine?: VoiceEngine;
  createMeter?: VoiceMeterFactory;
  /** Por defecto "none". */
  punctuationStrategy?: PunctuationStrategy;
  /** Desactivado por defecto. Al vencer llama stop(), NUNCA cancel(). */
  autoStopOnSilenceMs?: number;
  /** Red de seguridad. Por defecto 120_000. Llama stop(), NUNCA cancel(). */
  maxDurationMs?: number;
  /** Por defecto 3_000. Si vence, se registra un warning interno. */
  processingGuardMs?: number;
}

export interface VoiceSession {
  readonly state: VoiceState;
  start(): Promise<void>;
  /** FINALIZAR: conserva el texto. */
  stop(): Promise<void>;
  /** CANCELAR: descarta el texto. No es un error. */
  cancel(): void;
  on<K extends keyof VoiceSessionEvents>(
    event: K,
    cb: VoiceSessionEvents[K],
  ): () => void;
  dispose(): void;
}
