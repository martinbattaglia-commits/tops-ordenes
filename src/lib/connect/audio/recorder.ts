"use client";

// Nexus Link · LINK-MEDIA-001 — Hook de grabación de mensajes de voz.
// D1: Audio Message ≠ Voice Command — este hook usa MediaRecorder (graba el audio),
// no SpeechRecognition. Permisos con el mismo criterio que voice/session.ts:
// denegado ⇒ estado de error legible, jamás excepción sin manejar.
// D2: formato negociado — audio/mp4 si el navegador lo soporta (Safari/iOS,
// reproducible en todos lados), si no audio/webm;codecs=opus (Chrome/Android).

import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_LIMITS } from "./validate";

export type RecorderState = "idle" | "recording" | "preview" | "error";

export interface AudioRecorder {
  state: RecorderState;
  durationMs: number;
  blob: Blob | null;
  mimeType: string | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  reset: () => void;
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

export function useAudioRecorder(): AudioRecorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => cleanupStream, [cleanupStream]); // desmontaje: liberar el mic SIEMPRE

  const start = useCallback(async () => {
    setError(null);
    setBlob(null);
    setDurationMs(0);
    const mime = pickMimeType();
    if (!mime) {
      setError("Este navegador no soporta grabación de audio.");
      setState("error");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Micrófono no disponible o permiso denegado. Habilitalo en el navegador.");
      setState("error");
      return;
    }
    streamRef.current = stream;
    cancelledRef.current = false;
    chunksRef.current = [];
    const rec = new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = rec;
    setMimeType(mime);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      cleanupStream();
      if (cancelledRef.current) {
        chunksRef.current = [];
        setState("idle");
        return;
      }
      const out = new Blob(chunksRef.current, { type: mime.split(";")[0] });
      setBlob(out);
      setState("preview");
    };
    rec.start(250);
    startedAtRef.current = Date.now();
    setState("recording");
    timerRef.current = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setDurationMs(ms);
      // Tope duro de 5 min: se detiene solo y queda en preview.
      if (ms >= AUDIO_LIMITS.maxDurationMs && recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
    }, 250);
  }, [cleanupStream]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      cleanupStream();
      setBlob(null);
      setState("idle");
    }
  }, [cleanupStream]);

  const reset = useCallback(() => {
    setBlob(null);
    setDurationMs(0);
    setError(null);
    setState("idle");
  }, []);

  return { state, durationMs, blob, mimeType, error, start, stop, cancel, reset };
}
