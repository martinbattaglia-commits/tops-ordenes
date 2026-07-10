"use client";

import { useEffect, useState } from "react";
import { NexusVoice } from "@/lib/voice/nexus-voice";
import type { VoiceSession, VoiceState } from "@/lib/voice/types";

/**
 * Renderer por defecto del Modo Global. Se monta UNA sola vez en el shell y se
 * suscribe a NexusVoice. capture({ headless: true }) no publica nada y este
 * overlay no aparece: el llamador dibuja su propia interfaz.
 */
export function VoiceOverlay() {
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [state, setState] = useState<VoiceState>("idle");
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);

  useEffect(() => NexusVoice.subscribe(setSession), []);

  useEffect(() => {
    if (!session) {
      setPartial("");
      setLevel(0);
      return;
    }
    setState(session.state);
    const offs = [
      session.on("state", setState),
      session.on("partial", setPartial),
      session.on("level", setLevel),
    ];
    return () => offs.forEach((off) => off());
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const onKey = (ev: KeyboardEvent) => {
      // Escape = Cancelar. Misma regla que en Modo Campo. Ver spec §6.1.
      if (ev.key === "Escape") session.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  if (!session) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-6"
      onClick={() => session.cancel()}
      role="dialog"
      aria-modal="true"
      aria-label="Captura de voz"
    >
      <div
        className="card w-full max-w-md p-5 text-center"
        onClick={(ev) => ev.stopPropagation()}
      >
        <p className="text-eyebrow-sm uppercase text-fg-secondary">
          {state === "processing" ? "Transcribiendo…" : "Escuchando…"}
        </p>

        <div className="my-4 flex h-10 items-end justify-center gap-1" aria-hidden>
          {[0.4, 0.8, 1, 0.8, 0.4].map((weight, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-tops-red transition-[height] duration-75"
              style={{ height: `${6 + Math.min(1, level * weight) * 28}px` }}
            />
          ))}
        </div>

        <p className="min-h-[3rem] text-sm text-fg-primary">
          {partial || <span className="text-fg-muted">Hablá ahora.</span>}
        </p>

        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => session.cancel()}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={state !== "listening"}
            onClick={() => void session.stop()}
          >
            Finalizar
          </button>
        </div>
      </div>
    </div>
  );
}
