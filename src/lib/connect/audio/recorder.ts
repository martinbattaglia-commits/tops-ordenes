"use client";

// Nexus Link · LINK-MEDIA-001 — Hook de grabación de mensajes de voz.
// D1: Audio Message ≠ Voice Command — este hook usa MediaRecorder (graba el audio),
// no SpeechRecognition. Permisos con el mismo criterio que voice/session.ts:
// denegado ⇒ estado de error legible, jamás excepción sin manejar.
// D2: formato negociado — audio/mp4 si el navegador lo soporta (Safari/iOS,
// reproducible en todos lados), si no audio/webm;codecs=opus (Chrome/Android).
//
// FASE B · WhatsApp NO reproduce WebM. Para ese canal se PREFIERE un formato
// que Meta acepte tal cual, y si el navegador sólo da WebM se graba igual: el
// servidor lo reenvasa a Ogg antes de enviarlo. Grabar siempre es posible.

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

/** Orden de preferencia para Connect: lo mejor soportado por el navegador. */
export const MIME_PREFERIDOS = [
  "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus",
] as const;

/**
 * Orden de preferencia para WhatsApp.
 *
 * Primero lo que Meta reproduce tal cual —mp4, ogg/opus—, para no hacer trabajo
 * innecesario. Pero el WebM NO se descarta: Chrome y Android no ofrecen otra
 * cosa, y el servidor lo REENVASA a Ogg antes de mandarlo (mismo códec Opus,
 * otro contenedor, sin recodificar). Sacarlo de la lista dejaría a Android sin
 * mensajes de voz, que es el problema, no la solución.
 */
export const MIME_PREFERIDOS_WHATSAPP = [
  "audio/mp4", "audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm",
] as const;

export function pickMimeType(paraWhatsapp = false): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidatos = paraWhatsapp ? MIME_PREFERIDOS_WHATSAPP : MIME_PREFERIDOS;
  for (const t of candidatos) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

export interface AudioRecorderOptions {
  /**
   * Restringe la negociación a formatos que WhatsApp reproduce.
   *
   * No es una preferencia estética: con esto en `false` sobre Chrome/Android el
   * audio sale en WebM y Meta lo rechaza.
   */
  forWhatsapp?: boolean;
}

export function useAudioRecorder(options: AudioRecorderOptions = {}): AudioRecorder {
  const paraWhatsapp = options.forWhatsapp === true;
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
    const mime = pickMimeType(paraWhatsapp);
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
  }, [cleanupStream, paraWhatsapp]);

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
