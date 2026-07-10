import { resolveEngine } from "./engines";
import {
  VoiceEngineUnavailableError,
  VoicePermissionDeniedError,
  VoiceRecognitionError,
  toVoiceError,
  type VoiceError,
} from "./errors";
import { transition } from "./machine";
import { normalize } from "./normalize";
import { resolvePunctuator } from "./punctuation";
import type {
  VoiceEngine,
  VoiceSession,
  VoiceSessionEvents,
  VoiceSessionOptions,
  VoiceState,
} from "./types";

/** Inyectable para poder testear la frontera de permisos sin navegador. */
type StreamRequester = () => Promise<MediaStream | null>;

export interface CreateVoiceSessionOptions extends VoiceSessionOptions {
  requestStream?: StreamRequester;
}

const DEFAULT_LOCALE = "es-AR";
const DEFAULT_MAX_DURATION_MS = 120_000;
const DEFAULT_PROCESSING_GUARD_MS = 3_000;
/** Por debajo de esto consideramos silencio, para autoStopOnSilenceMs. */
const SILENCE_LEVEL = 0.05;

function defaultRequestStream(engine: VoiceEngine): StreamRequester {
  return async () => {
    const media = globalThis.navigator?.mediaDevices;
    if (!media?.getUserMedia) {
      if (engine.capabilities.requiresMediaStream) {
        throw new VoiceRecognitionError(
          "no-microphone",
          "No detectamos ningún micrófono conectado.",
        );
      }
      return null;
    }

    try {
      return await media.getUserMedia({ audio: true });
    } catch (raw) {
      const err = toVoiceError(raw);
      // El permiso es fatal: el reconocedor también fallaría.
      if (err instanceof VoicePermissionDeniedError) throw err;
      if (engine.capabilities.requiresMediaStream) throw err;

      // El motor no necesita el stream: el medidor se apaga y el dictado sigue.
      console.warn("[nexus-voice] medidor deshabilitado:", err.code);
      return null;
    }
  };
}

export function createVoiceSession(
  opts: CreateVoiceSessionOptions = {},
): VoiceSession {
  // La variable intermedia es necesaria: el narrowing de un const NO se
  // propaga a las declaraciones `function` hoisted de más abajo (TS18047).
  const engineOrNull = opts.engine ?? resolveEngine();
  if (!engineOrNull) throw new VoiceEngineUnavailableError();
  const engine: VoiceEngine = engineOrNull;

  const locale = opts.locale ?? DEFAULT_LOCALE;
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const processingGuardMs = opts.processingGuardMs ?? DEFAULT_PROCESSING_GUARD_MS;
  const punctuator = resolvePunctuator(opts.punctuationStrategy ?? "none", engine);
  const requestStream = opts.requestStream ?? defaultRequestStream(engine);

  let state: VoiceState = "idle";
  let segments: string[] = [];
  let settled = false;
  let stream: MediaStream | null = null;
  let stopMeter: (() => void) | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let guardTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const listeners: {
    [K in keyof VoiceSessionEvents]: Set<VoiceSessionEvents[K]>;
  } = {
    state: new Set(),
    partial: new Set(),
    level: new Set(),
    final: new Set(),
    error: new Set(),
  };

  function emit<K extends keyof VoiceSessionEvents>(
    event: K,
    ...args: Parameters<VoiceSessionEvents[K]>
  ): void {
    if (disposed) return;
    for (const cb of listeners[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }

  function go(action: Parameters<typeof transition>[1]): void {
    const next = transition(state, action);
    if (next === state) return;
    state = next;
    emit("state", next);
  }

  function clearTimers(): void {
    if (maxTimer) clearTimeout(maxTimer);
    if (silenceTimer) clearTimeout(silenceTimer);
    if (guardTimer) clearTimeout(guardTimer);
    maxTimer = silenceTimer = guardTimer = null;
  }

  function releaseMic(): void {
    stopMeter?.();
    stopMeter = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  }

  function armSilence(): void {
    if (!opts.autoStopOnSilenceMs) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    // Un silencio prolongado FINALIZA (conserva el texto). Nunca cancela.
    silenceTimer = setTimeout(() => void stop(), opts.autoStopOnSilenceMs);
  }

  async function settle(): Promise<void> {
    if (settled) return;
    settled = true;

    // También silenceTimer: un partial/final tardío del motor durante
    // engine.stop() pudo rearmarlo, y quedaría disparando no-ops tras idle.
    clearTimers();
    releaseMic();

    const raw = segments.join(" ");
    segments = [];

    const text = normalize(await punctuator.apply(raw));

    // Si un cancel()/dispose() se coló durante el await de un punctuator
    // asíncrono (la estrategia "ai" futura), el texto quedó descartado y
    // emitir acá violaría "cancelar descarta". Con los punctuators actuales
    // (resuelven en microtask) esta ventana es inalcanzable; el guard sella
    // el contrato contra el futuro.
    if (state !== "processing") return;

    // ORDEN CONTRACTUAL: `final` primero, `idle` después. capture() depende de esto.
    if (text.length > 0) emit("final", text);
    go({ type: "SETTLED" });
  }

  function fail(raw: unknown): void {
    if (settled) return;
    settled = true;
    clearTimers();
    engine.abort();
    releaseMic();
    segments = [];

    const error: VoiceError = toVoiceError(raw);
    go({ type: "FAIL" });
    emit("error", error);
  }

  async function start(): Promise<void> {
    if (state === "listening" || state === "processing") return;
    if (!engine.isAvailable()) throw new VoiceEngineUnavailableError();

    settled = false;
    segments = [];

    // Los permisos los pide la SESIÓN, antes de que el motor exista.
    // Un requestStream INYECTADO (tests, futuros providers) lanza errores
    // crudos: la sesión los traduce acá con la misma política que
    // defaultRequestStream — permiso denegado y motor-que-exige-stream son
    // fatales; el resto continúa sin medidor.
    try {
      stream = await requestStream();
    } catch (raw) {
      const err = toVoiceError(raw);
      if (err instanceof VoicePermissionDeniedError) throw err;
      if (engine.capabilities.requiresMediaStream) throw err;
      // El motor no necesita el stream: continúa sin él.
    }

    go({ type: "START" });

    if (stream && opts.createMeter) {
      const meter = opts.createMeter(stream);
      const off = meter.onLevel((level) => {
        emit("level", level);
        if (level > SILENCE_LEVEL) armSilence();
      });
      stopMeter = () => {
        off();
        meter.stop();
      };
    }

    try {
      await engine.start({
        locale,
        stream,
        onPartial: (text) => {
          emit("partial", text);
          armSilence();
        },
        onFinal: (text) => {
          if (text.trim().length > 0) segments.push(text.trim());
          armSilence();
        },
        onError: fail,
      });
    } catch (raw) {
      // El motor no pudo arrancar (InvalidStateError de Chrome; auth/red de
      // un motor de nube futuro). Sin esto la sesión quedaría colgada en
      // "listening" con el micrófono abierto y el medidor corriendo. fail()
      // libera todo, pasa a "error" y el usuario reintenta con un clic.
      fail(raw);
      return;
    }

    maxTimer = setTimeout(() => void stop(), maxDurationMs);
    armSilence();
  }

  async function stop(): Promise<void> {
    if (state !== "listening") return;
    clearTimers();
    go({ type: "STOP" });

    guardTimer = setTimeout(() => {
      console.warn(
        `[nexus-voice] el motor "${engine.id}" no emitió el evento final ` +
          `en ${processingGuardMs}ms. Se cierra la sesión con el texto disponible.`,
      );
      void settle();
    }, processingGuardMs);

    await engine.stop();
    await settle();
  }

  function cancel(): void {
    if (state !== "listening" && state !== "processing") return;
    settled = true;
    clearTimers();
    engine.abort();
    releaseMic();
    segments = [];
    go({ type: "CANCEL" }); // NO emite `final`. NO emite `error`.
  }

  return {
    get state() {
      return state;
    },
    start,
    stop,
    cancel,
    on(event, cb) {
      listeners[event].add(cb as never);
      return () => {
        listeners[event].delete(cb as never);
      };
    },
    dispose() {
      cancel();
      disposed = true;
      for (const set of Object.values(listeners)) set.clear();
    },
  };
}
