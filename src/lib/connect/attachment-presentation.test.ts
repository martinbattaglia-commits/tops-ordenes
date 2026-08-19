// H-1 · cómo se PRESENTA un adjunto. Lógica pura, medida.
//
// La regla que estas pruebas fijan: ningún adjunto queda sin forma de abrirse.
// Lo que no se puede previsualizar se descarga; nunca se cae al texto plano,
// que es exactamente lo que hacía el hilo antes de este arreglo.

import { describe, it, expect } from "vitest";
import { presentAttachment, formatFileSize } from "./attachment-presentation";

const base = { id: "a-1", fileName: "x", mimeType: null, fileSize: null, scanStatus: "clean" };

describe("H-1 · la forma de presentar depende del tipo REAL", () => {
  it("una imagen se previsualiza", () => {
    const p = presentAttachment({ ...base, fileName: "foto.png", mimeType: "image/png" });
    expect(p.mode).toBe("image");
  });

  it("un audio va al reproductor", () => {
    const p = presentAttachment({ ...base, fileName: "voz.ogg", mimeType: "audio/ogg" });
    expect(p.mode).toBe("audio");
  });

  it("un PDF no se previsualiza pero SÍ se descarga", () => {
    const p = presentAttachment({ ...base, fileName: "remito.pdf", mimeType: "application/pdf" });
    expect(p.mode).toBe("download");
  });

  it("sin MIME conocido NO se cae al texto: se ofrece descarga", () => {
    const p = presentAttachment({ ...base, fileName: "cosa.bin", mimeType: null });
    expect(p.mode).toBe("download");
  });

  it("un MIME con parámetros se normaliza (audio/ogg;codecs=opus)", () => {
    const p = presentAttachment({ ...base, fileName: "voz", mimeType: "audio/ogg;codecs=opus" });
    expect(p.mode).toBe("audio");
  });
});

describe("H-1 · el adjunto se nombra aunque le falten datos", () => {
  it("sin nombre se usa una etiqueta neutra, nunca vacío", () => {
    const p = presentAttachment({ ...base, fileName: null, mimeType: "image/png" });
    expect(p.label.trim().length).toBeGreaterThan(0);
  });

  it("el tamaño se muestra cuando existe y se omite cuando no", () => {
    expect(presentAttachment({ ...base, fileSize: 2048 }).sizeLabel).toBe("2 KB");
    expect(presentAttachment({ ...base, fileSize: null }).sizeLabel).toBeNull();
  });
});

describe("H-1 · un adjunto no verificado no se muestra como seguro", () => {
  it("scan_status distinto de 'clean' se marca y NO se previsualiza", () => {
    const p = presentAttachment({
      ...base, fileName: "foto.png", mimeType: "image/png", scanStatus: "pending",
    });
    expect(p.mode).toBe("download");
    expect(p.unverified).toBe(true);
  });

  it("un adjunto limpio no lleva la marca", () => {
    expect(presentAttachment({ ...base, mimeType: "image/png", scanStatus: "clean" }).unverified).toBe(false);
  });
});

describe("H-1 · formato de tamaño", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1 KB"],
    [1536, "1,5 KB"],
    [1048576, "1 MB"],
    [5 * 1048576, "5 MB"],
  ])("%i bytes → %s", (bytes, esperado) => {
    expect(formatFileSize(bytes)).toBe(esperado);
  });
});
