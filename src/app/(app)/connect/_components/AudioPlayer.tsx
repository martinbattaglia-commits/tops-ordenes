"use client";

// Nexus Link · LINK-MEDIA-001 — Reproductor ÚNICO de audio.
// Sirve para: (a) preview local de una grabación (src=blob URL), (b) mensajes de audio
// nativos (messageId → signed URL on-demand) y (c) futuras notas de voz de WhatsApp
// importadas (mismo camino que b). SIN autoplay, con loading y error legible (D2:
// un formato no reproducible en este dispositivo se informa, no se promete).

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { getAudioUrlAction } from "@/lib/connect/adapters/driving/audio-actions";

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({
  src, messageId, compact = false,
}: {
  /** URL directa (preview local con blob URL). */
  src?: string;
  /** Mensaje de audio persistido: la URL firmada se pide on-demand al primer play. */
  messageId?: string;
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(src ?? null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (src) setResolvedSrc(src);
  }, [src]);

  async function ensureSrc(): Promise<string | null> {
    if (resolvedSrc) return resolvedSrc;
    if (!messageId) return null;
    setLoading(true);
    setError(null);
    try {
      const r = await getAudioUrlAction({ messageId });
      if (!r.ok) {
        setError(r.message);
        return null;
      }
      setResolvedSrc(r.url);
      return r.url;
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    const url = await ensureSrc();
    if (!url) return;
    if (el.src !== url) el.src = url;
    try {
      await el.play();
    } catch {
      setError("No se puede reproducir este audio en este dispositivo (formato no soportado).");
    }
  }

  function seek(v: number) {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = (v / 100) * el.duration;
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className={compact ? "flex items-center gap-2" : "flex w-64 max-w-full items-center gap-2"}>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
        onError={() => setError("No se puede reproducir este audio en este dispositivo (formato no soportado).")}
      />
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={loading}
        title={playing ? "Pausar" : "Reproducir"}
        className="focus-nexus grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tops-red text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Icon name={loading ? "refresh" : playing ? "pause" : "play"} size={13} />
      </button>
      <div className="min-w-0 flex-1">
        {error ? (
          <p className="text-[10px] text-tops-red">{error}</p>
        ) : (
          <>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              aria-label="Posición del audio"
              onChange={(e) => seek(Number(e.target.value))}
              className="w-full accent-[#c90812]"
            />
            <div className="flex justify-between text-[10px] text-fg-muted">
              <span>{fmt(current)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
