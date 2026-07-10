import { BuildFlagSource, isVoiceEnabled, type VoiceConfigSource } from "./config";
import { isVoiceSupported } from "./engines";
import { VoiceEngineUnavailableError, VoiceSessionAlreadyRunningError } from "./errors";
import { createVoiceSession, type CreateVoiceSessionOptions } from "./session";
import type { VoiceSession } from "./types";

export interface CaptureOptions extends CreateVoiceSessionOptions {
  /** "takeover" (por defecto) finaliza la sesión previa con stop(). */
  conflict?: "takeover" | "reject";
  /** true → capture() no publica la sesión; el llamador dibuja su propia UI. */
  headless?: boolean;
  signal?: AbortSignal;
}

let sources: readonly VoiceConfigSource[] = [
  new BuildFlagSource(process.env.NEXT_PUBLIC_VOICE_ENABLED),
];

let active: VoiceSession | null = null;
let presented: VoiceSession | null = null;
const subscribers = new Set<(session: VoiceSession | null) => void>();

/**
 * Cola de adquisición: vuelve atómico el tramo chequear-liberar-adquirir-arrancar
 * de capture(). Sin ella, dos takeovers concurrentes (dos taps rápidos de
 * micrófono) se pisan: uno cancela a la sesión previa (texto perdido) y el otro
 * lanza VoiceSessionAlreadyRunningError pese a haber pedido takeover. Con la
 * cola, el último gana y nada se pierde.
 */
let acquireQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = acquireQueue.then(fn, fn);
  acquireQueue = next.catch(() => {});
  return next;
}

function present(session: VoiceSession | null): void {
  presented = session;
  for (const cb of subscribers) cb(session);
}

/**
 * Un solo micrófono, una sola dueña. Ver spec §5.
 * La política de takeover NO vive acá: el núcleo nunca adivina.
 */
function acquire(opts: CreateVoiceSessionOptions = {}): VoiceSession {
  if (active) throw new VoiceSessionAlreadyRunningError();

  const inner = createVoiceSession(opts);

  // `active` y `presented` guardan el WRAPPER, no la sesión interna.
  // Comparar contra `inner` acá dejaría `presented` colgado y el overlay abierto.
  const wrapper: VoiceSession = {
    get state() {
      return inner.state;
    },
    start: () => inner.start(),
    stop: () => inner.stop(),
    cancel: () => inner.cancel(),
    on: (event, cb) => inner.on(event, cb),
    dispose: () => {
      inner.dispose();
      if (active === wrapper) active = null;
      if (presented === wrapper) present(null);
    },
  };

  active = wrapper;
  return wrapper;
}

/**
 * Adquisición con política de takeover, sobre la MISMA cola que capture():
 * la sesión anterior finaliza limpia (stop, jamás cancel) y recién entonces
 * se adquiere. Es el camino para consumidores con UI propia — el hook React.
 * Sin la cola, dos taps rápidos en micrófonos distintos se pisarían y el
 * perdedor vería VoiceSessionAlreadyRunningError en vez del takeover.
 */
function acquireForTakeover(
  opts: CreateVoiceSessionOptions = {},
): Promise<VoiceSession> {
  return serialize(async () => {
    await releaseActive();
    return acquire(opts);
  });
}

/** Finaliza la sesión activa conservando su texto. Nunca la cancela. */
async function releaseActive(): Promise<void> {
  const current = active;
  if (!current) return;

  if (current.state === "listening") {
    await current.stop();
  } else if (current.state === "processing") {
    // Su propio stop() está en vuelo (auto-stop, maxDurationMs, o su dueño
    // apretó Finalizar). dispose() acá cancelaría el settle() en vuelo y el
    // dueño anterior PERDERÍA su texto. Se espera el cierre — espera acotada:
    // el guard de processing (3 s) garantiza que este estado siempre termina.
    await new Promise<void>((resolve) => {
      const off = current.on("state", (s) => {
        if (s === "idle" || s === "error") {
          off();
          resolve();
        }
      });
      // Por si transicionó entre el chequeo y la suscripción:
      if (current.state !== "processing") {
        off();
        resolve();
      }
    });
  }
  current.dispose();
}

async function capture(opts: CaptureOptions = {}): Promise<string | null> {
  if (!isEnabled() || (!opts.engine && !isSupported())) {
    throw new VoiceEngineUnavailableError();
  }

  // Un signal que ya venía abortado: el listener "abort" nunca dispararía y
  // el micrófono quedaría abierto hasta maxDurationMs (~120 s).
  if (opts.signal?.aborted) return null;

  // start() vive DENTRO de la sección crítica: si quedara afuera, un takeover
  // concurrente podría disponer una sesión adquirida pero aún no arrancada, y
  // su capture() colgaría para siempre (los listeners se registran después).
  const session = await serialize(async () => {
    if (active) {
      if (opts.conflict === "reject") throw new VoiceSessionAlreadyRunningError();
      await releaseActive();
    }
    const s = acquire(opts);
    try {
      await s.start();
    } catch (raw) {
      s.dispose();
      throw raw;
    }
    return s;
  });

  if (!opts.headless) present(session);

  try {
    return await new Promise<string | null>((resolve, reject) => {
      let result: string | null = null;

      // `final` se emite ANTES de la transición a idle (contrato de VoiceSession).
      session.on("final", (text) => {
        result = text;
      });
      session.on("error", reject);
      // La sesión ya está en "listening" (arrancó en la sección crítica): el
      // próximo "idle" solo puede venir de settle o cancel.
      session.on("state", (state) => {
        if (state === "idle") resolve(result);
      });

      opts.signal?.addEventListener("abort", () => session.cancel(), {
        once: true,
      });
      // Ventana entre el chequeo temprano y esta suscripción:
      if (opts.signal?.aborted) session.cancel();
    });
  } finally {
    session.dispose();
  }
}

function isEnabled(): boolean {
  return isVoiceEnabled(sources);
}

function isSupported(): boolean {
  return isVoiceSupported();
}

export const NexusVoice = {
  configure(opts: { sources: readonly VoiceConfigSource[] }): void {
    sources = opts.sources;
  },
  isEnabled,
  isSupported,
  get active(): VoiceSession | null {
    return active;
  },
  subscribe(cb: (session: VoiceSession | null) => void): () => void {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },
  acquire,
  acquireForTakeover,
  releaseActive,
  capture,
};
