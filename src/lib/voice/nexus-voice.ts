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

/** Finaliza la sesión activa conservando su texto. Nunca la cancela. */
async function releaseActive(): Promise<void> {
  const current = active;
  if (!current) return;
  if (current.state === "listening") await current.stop();
  current.dispose();
}

async function capture(opts: CaptureOptions = {}): Promise<string | null> {
  if (!isEnabled() || (!opts.engine && !isSupported())) {
    throw new VoiceEngineUnavailableError();
  }

  if (active) {
    if (opts.conflict === "reject") throw new VoiceSessionAlreadyRunningError();
    await releaseActive();
  }

  const session = acquire(opts);
  if (!opts.headless) present(session);

  try {
    return await new Promise<string | null>((resolve, reject) => {
      let result: string | null = null;
      let started = false;

      // `final` se emite ANTES de la transición a idle (contrato de VoiceSession).
      session.on("final", (text) => {
        result = text;
      });
      session.on("error", reject);
      session.on("state", (state) => {
        if (state === "listening") started = true;
        else if (state === "idle" && started) resolve(result);
      });

      opts.signal?.addEventListener("abort", () => session.cancel(), {
        once: true,
      });

      session.start().catch(reject);
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
  releaseActive,
  capture,
};
