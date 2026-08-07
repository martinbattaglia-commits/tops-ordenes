// Nexus Link · LINK-MEDIA-001 — Validación de audio (PURA, sin IO).
// Regla de la resolución: JAMÁS confiar en el MIME que declara el navegador —
// el tipo real se determina por la firma binaria (magic bytes) del archivo.

export const AUDIO_LIMITS = {
  maxBytes: 10 * 1024 * 1024, // 10 MB
  maxDurationMs: 5 * 60_000, // 5 minutos
} as const;

export interface SniffedAudio {
  mime: "audio/webm" | "audio/mp4" | "audio/ogg" | "audio/mpeg";
  ext: "webm" | "m4a" | "ogg" | "mp3";
}

/** Detecta el contenedor real por firma binaria. null = no es un audio soportado. */
export function sniffAudio(bytes: Uint8Array): SniffedAudio | null {
  if (bytes.length < 12) return null;
  // EBML (WebM/Matroska): 1A 45 DF A3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { mime: "audio/webm", ext: "webm" };
  }
  // ISO BMFF (MP4/M4A): 'ftyp' en offset 4
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return { mime: "audio/mp4", ext: "m4a" };
  }
  // Ogg (Opus/Vorbis — formato de notas de voz de WhatsApp): 'OggS'
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return { mime: "audio/ogg", ext: "ogg" };
  }
  // MP3: tag 'ID3' o frame-sync 0xFF 0xEx/0xFx
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return { mime: "audio/mpeg", ext: "mp3" };
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return { mime: "audio/mpeg", ext: "mp3" };
  }
  return null;
}

export type AudioValidation =
  | { ok: true; sniffed: SniffedAudio }
  | { ok: false; message: string };

/** Validación completa server-side: firma real + límites duros. */
export function validateAudio(bytes: Uint8Array, declaredDurationMs: number): AudioValidation {
  if (bytes.length === 0) return { ok: false, message: "Archivo vacío." };
  if (bytes.length > AUDIO_LIMITS.maxBytes) {
    return { ok: false, message: "El audio supera el máximo de 10 MB." };
  }
  if (declaredDurationMs > AUDIO_LIMITS.maxDurationMs) {
    return { ok: false, message: "El audio supera el máximo de 5 minutos." };
  }
  const sniffed = sniffAudio(bytes);
  if (!sniffed) {
    return { ok: false, message: "El archivo no es un audio válido (firma binaria desconocida)." };
  }
  return { ok: true, sniffed };
}
