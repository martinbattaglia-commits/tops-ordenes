import type { VoiceMeter } from "./types";

/**
 * Medidor REAL. Nunca una animación simulada: un medidor falso le confirmaría
 * al usuario que el micrófono capta su voz incluso cuando no capta nada, que es
 * exactamente el problema que el medidor existe para resolver. Ver spec §10.
 *
 * Si AudioContext no está disponible, devuelve null y la sesión degrada a pulso.
 */
export const createAnalyserMeter = (stream: MediaStream): VoiceMeter => {
  const AudioCtor =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext)
      : undefined;

  const listeners = new Set<(rms: number) => void>();
  let raf = 0;
  let ctx: AudioContext | null = null;

  if (AudioCtor) {
    ctx = new AudioCtor();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      const rms = Math.sqrt(sum / buffer.length);
      // Escala perceptual: la voz normal ronda 0.02–0.2 de RMS.
      const level = Math.min(1, rms * 6);
      for (const cb of listeners) cb(level);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  return {
    onLevel(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      listeners.clear();
      void ctx?.close();
      ctx = null;
    },
  };
};
