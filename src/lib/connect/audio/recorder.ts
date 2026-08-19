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
 * ─── POR QUÉ `audio/mp4` VA ÚLTIMO ────────────────────────────────────────
 *
 * Estaba PRIMERO, con el razonamiento de que Meta lo reproduce tal cual. Eso es
 * cierto del mp4 de Safari, que lleva AAC. Pero Chromium también contesta
 * `isTypeSupported("audio/mp4") === true` —medido en Chromium 148— y lo que
 * produce es **Opus dentro de un MP4 fragmentado**: el binario rechazado en
 * producción tiene el sample entry `Opus` y el box `dOps`, y ni `esds` ni
 * `mp4a` por ningún lado.
 *
 * Meta acepta `audio/mp4` esperando AAC. Al abrirlo no lo reconoce y contesta,
 * textual: «uploaded with mimetype as audio/mp4, however on processing it is of
 * type application/octet-stream». Ese rechazo llega ASINCRÓNICO, por webhook,
 * después de que Meta ya aceptó la subida y devolvió el wamid — por eso el
 * envío parecía exitoso y el error aparecía horas más tarde.
 *
 * Efecto colateral que también cierra: como Chromium siempre ganaba con mp4, la
 * rama de reenvasado a Ogg NUNCA corrió en producción. Los seis audios
 * salientes registrados son `audio/mp4`; ninguno webm.
 *
 * El orden nuevo pone adelante todo lo que lleva Opus, que es el códec que usa
 * el propio WhatsApp —los audios ENTRANTES que manda Meta son `audio/ogg`—:
 *
 *   · Firefox     → `audio/ogg;codecs=opus`, directo, sin reenvasar;
 *   · Chromium    → `audio/webm;codecs=opus`, y el servidor lo reenvasa a Ogg
 *                   (mismo códec, otro contenedor, sin recodificar);
 *   · Safari      → cae en `audio/mp4`, y el suyo SÍ es AAC.
 *
 * `audio/mp4` NO se saca de la lista: sacarlo dejaría a Safari sin mensajes de
 * voz, que es el problema, no la solución.
 */
export const MIME_PREFERIDOS_WHATSAPP = [
  "audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4",
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
