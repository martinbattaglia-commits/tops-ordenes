"use client";

import type { VoiceState } from "@/lib/voice/types";

const LABELS: Record<VoiceState, string> = {
  idle: "Dictar por voz",
  listening: "Escuchando. Hacé clic para finalizar.",
  processing: "Transcribiendo…",
  error: "Error de dictado. Hacé clic para reintentar.",
};

const ANNOUNCE: Record<VoiceState, string> = {
  idle: "",
  listening: "Escuchando",
  processing: "Transcribiendo",
  error: "Error de dictado",
};

const BARS = [0.35, 0.7, 1, 0.7, 0.35];

export interface VoiceMicButtonProps {
  state: VoiceState;
  level: number;
  error: string | null;
  /** true = el medidor real emite; el botón muestra barras. false = pulso. */
  meterActive: boolean;
  onStart(): void;
  onStop(): void;
  className?: string;
}

export function VoiceMicButton({
  state,
  level,
  error,
  meterActive,
  onStart,
  onStop,
  className = "",
}: VoiceMicButtonProps) {
  const listening = state === "listening";
  const processing = state === "processing";

  return (
    <>
      <button
        type="button"
        // Evita que el campo pierda el foco: sin esto se pierde el caret y
        // la inserción "en el cursor" falla. Ver spec §8.2.
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={() => (listening ? onStop() : onStart())}
        disabled={processing}
        aria-pressed={listening}
        aria-label={LABELS[state]}
        title={error ?? LABELS[state]}
        className={`nx-voice-mic inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md
          text-fg-muted transition-colors hover:text-fg-primary disabled:opacity-50
          ${listening && !meterActive ? "nx-voice-mic--live" : ""}
          ${listening ? "text-tops-red" : ""}
          ${state === "error" ? "text-status-warning" : ""} ${className}`}
      >
        {processing ? (
          <span className="nx-voice-spinner h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" />
        ) : listening && meterActive ? (
          // Barras REALES: solo cuando el medidor emite. Nunca simuladas.
          <span className="flex items-end gap-[2px]" aria-hidden>
            {BARS.map((weight, i) => (
              <span
                key={i}
                className="w-[2px] rounded-full bg-current"
                style={{ height: `${4 + Math.min(1, level * weight) * 12}px` }}
              />
            ))}
          </span>
        ) : (
          // Idle, error, o listening sin medidor (degradación: ícono con pulso).
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <span className="sr-only" aria-live="polite">
        {state === "error" && error ? error : ANNOUNCE[state]}
      </span>
    </>
  );
}
