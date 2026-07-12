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
  /** true desde el primer evento `level`: el medidor REAL está emitiendo. */
  meterActive: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
}

export function useVoiceSession(opts: UseVoiceSessionOptions): VoiceSessionBinding {
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  // ¿El medidor REAL está emitiendo? El primer evento `level` (aunque valga 0:
  // el tick corre a cadencia de rAF también en silencio) lo confirma. El botón
  // muestra barras reales O el pulso de degradación — nunca ambos.
  const [meterActive, setMeterActive] = useState(false);

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
    // El desmontaje/limpieza descarta el dictado en curso: no existe el campo
    // destino después de desmontar. Decisión explícita de producto (spec §12),
    // no un bug — el desmontaje equivale a Cancelar.
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setLevel(0);
    setPartial("");
    setMeterActive(false);
  }, []);

  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setError(null);

    // Takeover por la MISMA cola serializada que capture(): la sesión anterior
    // finaliza con stop() y entrega su texto a SU campo antes de ceder el
    // micrófono. Nunca cancel(). Dos taps rápidos en micrófonos distintos no
    // se pisan: gana el último, sin VoiceSessionAlreadyRunningError espurio.
    let session: VoiceSession;
    try {
      session = await NexusVoice.acquireForTakeover({
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
    session.on("state", (s) => {
      setState(s);
      // RECONCILIACIÓN: la sesión puede terminar por caminos AJENOS al hook —
      // error del motor en vuelo (no-speech, red), o takeover de otro campo
      // (releaseActive la finaliza por fuera). Sin esto, sessionRef quedaría
      // apuntando a una sesión muerta y el próximo clic chocaría con el guard
      // de start(): micrófono muerto hasta remontar el componente.
      // dispose() es idempotente: si el hook (stop/cancel) o el takeover ya
      // dispusieron, es un no-op; si nadie lo hizo (error del motor), libera
      // `active` en la fachada. El mensaje de error queda visible.
      if (s === "idle" || s === "error") {
        if (sessionRef.current === session) {
          sessionRef.current = null;
          // El dispose se DIFIERE a un microtask. Hacerlo sincrónicamente
          // dentro de esta emisión vaciaría el Set de listeners a mitad de
          // iteración: el waiter de releaseActive() (suscripto después de
          // este listener) nunca dispararía y la cola de adquisición
          // quedaría bloqueada para siempre; y el emit("error") que sigue
          // al state:"error" de fail() ya no llegaría al hook (mensaje de
          // error perdido). Un microtask después, ambas emisiones síncronas
          // ya terminaron; dispose() sigue siendo idempotente.
          queueMicrotask(() => session.dispose());
          setLevel(0);
          setPartial("");
          setMeterActive(false);
        }
      }
    });
    session.on("level", (rms) => {
      setLevel(rms);
      setMeterActive(true);
    });
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

  return { state, level, partial, error, enabled, meterActive, start, stop, cancel };
}
