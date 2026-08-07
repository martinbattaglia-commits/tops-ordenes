import { describe, expect, it } from "vitest";
import { sniffAudio, validateAudio, AUDIO_LIMITS } from "./validate";

// LINK-MEDIA-001 · la regla: el MIME real sale de la firma binaria, no del navegador.

function bytes(head: number[], size = 64): Uint8Array {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
}

describe("audio/validate · sniffAudio (magic bytes)", () => {
  it("WebM (EBML 1A45DFA3)", () => {
    expect(sniffAudio(bytes([0x1a, 0x45, 0xdf, 0xa3]))?.mime).toBe("audio/webm");
  });
  it("MP4/M4A ('ftyp' en offset 4)", () => {
    expect(sniffAudio(bytes([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))?.mime).toBe("audio/mp4");
  });
  it("Ogg ('OggS' — formato de notas de voz de WhatsApp)", () => {
    expect(sniffAudio(bytes([0x4f, 0x67, 0x67, 0x53]))?.mime).toBe("audio/ogg");
  });
  it("MP3 (ID3 y frame-sync)", () => {
    expect(sniffAudio(bytes([0x49, 0x44, 0x33]))?.mime).toBe("audio/mpeg");
    expect(sniffAudio(bytes([0xff, 0xfb]))?.mime).toBe("audio/mpeg");
  });
  it("MIME falso: un PDF disfrazado de audio → null", () => {
    expect(sniffAudio(bytes([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
  });
  it("archivo demasiado corto → null", () => {
    expect(sniffAudio(new Uint8Array([0x1a, 0x45]))).toBeNull();
  });
});

describe("audio/validate · validateAudio (límites duros)", () => {
  const webm = bytes([0x1a, 0x45, 0xdf, 0xa3]);
  it("audio válido dentro de límites → ok", () => {
    const r = validateAudio(webm, 30_000);
    expect(r.ok).toBe(true);
  });
  it("excede 10 MB → rechazo", () => {
    const big = new Uint8Array(AUDIO_LIMITS.maxBytes + 1);
    big.set([0x1a, 0x45, 0xdf, 0xa3]);
    const r = validateAudio(big, 30_000);
    expect(r.ok).toBe(false);
  });
  it("excede 5 minutos → rechazo", () => {
    const r = validateAudio(webm, AUDIO_LIMITS.maxDurationMs + 1);
    expect(r.ok).toBe(false);
  });
  it("firma desconocida → rechazo con mensaje claro", () => {
    const r = validateAudio(bytes([0x00, 0x01, 0x02, 0x03]), 1_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("firma binaria");
  });
});
