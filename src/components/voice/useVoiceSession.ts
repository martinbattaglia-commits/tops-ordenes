"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NexusVoice } from "@/lib/voice/nexus-voice";
import { createAnalyserMeter } from "@/lib/voice/meter";
import { toVoiceError } from "@/lib/voice/errors";
import type { PunctuationStrategy, VoiceSession, VoiceState } from "@/lib/voice/types";

export interface UseVoiceSessionOptions {
  /** Recibe el texto final, exactamente una vez por dictado. */
  onFinal(text: string): void;
  locale?: string;
  punctuationStrategy?: PunctuationStrategy;
  autoStopOnSilenceMs?: number;
}

export interface VoiceSessionBinding {
  state: VoiceState;
  level: number;
  partial: string;
  error: string | null;
  enabled: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
}

export function useVoiceSession(opts: UseVoiceSessionOptions): VoiceSessionBinding {
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);

  // En el servidor no hay `window`, así que isSupported() es false. Calcularlo
  // durante el render produciría un desajuste de hidratación: el servidor
  // dibuja el campo sin micrófono y el cliente con micrófono. Se resuelve
  // después del montaje, cuando ya no hay HTML del servidor que contradecir.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(NexusVoice.isEnabled() && NexusVoice.isSupported());
  }, []);

  const sessionRef = useRef<VoiceSession | null>(null);
  const onFinalRef = useRef(opts.onFinal);
  onFinalRef.current = opts.onFinal;

  const release = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setLevel(0);
    setPartial("");
  }, []);

  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setError(null);

    // Takeover: la sesión anterior finaliza con stop() y entrega su texto a
    // SU campo original antes de ceder el micrófono. Nunca cancel(). Spec §5.
    await NexusVoice.releaseActive();

    let session: VoiceSession;
    try {
      session = NexusVoice.acquire({
        locale: opts.locale,
        punctuationStrategy: opts.punctuationStrategy,
        autoStopOnSilenceMs: opts.autoStopOnSilenceMs,
        createMeter: createAnalyserMeter,
      });
    } catch (raw) {
      setError(toVoiceError(raw).message);
      setState("error");
      return;
    }

    sessionRef.current = session;
    session.on("state", setState);
    session.on("level", setLevel);
    session.on("partial", setPartial);
    session.on("final", (text) => onFinalRef.current(text));
    session.on("error", (err) => setError(err.message));

    try {
      await session.start();
    } catch (raw) {
      setError(toVoiceError(raw).message);
      setState("error");
      release();
    }
  }, [opts.locale, opts.punctuationStrategy, opts.autoStopOnSilenceMs, release]);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    await session.stop(); // conserva el texto: onFinal ya corrió
    release();
  }, [release]);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel(); // descarta el texto
    release();
    setState("idle");
  }, [release]);

  return { state, level, partial, error, enabled, start, stop, cancel };
}
