// El formato que se negocia para WhatsApp, MEDIDO contra el soporte real de
// cada motor.
//
// ─── QUÉ PASÓ ─────────────────────────────────────────────────────────────
//
// `MIME_PREFERIDOS_WHATSAPP` pedía `audio/mp4` PRIMERO, con el razonamiento de
// que Meta lo reproduce tal cual. Es cierto para el mp4 de Safari, que lleva
// AAC. Pero Chromium también responde `isTypeSupported("audio/mp4") === true`
// —medido en Chromium 148— y lo que produce es **Opus dentro de un MP4
// fragmentado**: el binario rechazado en producción tiene el sample entry
// `Opus`, el box `dOps`, y ni `esds` ni `mp4a` por ningún lado.
//
// Meta acepta `audio/mp4` esperando AAC. Al abrirlo no lo reconoce y contesta,
// textual: «uploaded with mimetype as audio/mp4, however on processing it is of
// type application/octet-stream».
//
// Consecuencia colateral: como Chromium siempre ganaba con mp4, la rama de
// reenvasado a Ogg NUNCA se ejecutó en producción. Los seis audios salientes
// registrados son `audio/mp4`; ninguno webm.

import { describe, it, expect, vi, afterEach } from "vitest";
import { MIME_PREFERIDOS_WHATSAPP, pickMimeType } from "./recorder";

/** Soporte medido en Chromium 148 (motor de Chrome y de Edge). */
const CHROMIUM: Record<string, boolean> = {
  "audio/mp4": true,
  "audio/mp4;codecs=mp4a.40.2": true,
  "audio/webm;codecs=opus": true,
  "audio/webm": true,
  "audio/ogg;codecs=opus": false,
};

/** Safari: sólo MP4, y el suyo lleva AAC — que es lo que Meta espera. */
const SAFARI: Record<string, boolean> = {
  "audio/mp4": true,
  "audio/webm;codecs=opus": false,
  "audio/webm": false,
  "audio/ogg;codecs=opus": false,
};

/** Firefox: Ogg/Opus nativo, que es exactamente lo que WhatsApp usa. */
const FIREFOX: Record<string, boolean> = {
  "audio/mp4": false,
  "audio/webm;codecs=opus": true,
  "audio/webm": true,
  "audio/ogg;codecs=opus": true,
};

function conSoporte(tabla: Record<string, boolean>) {
  vi.stubGlobal("MediaRecorder", {
    isTypeSupported: (t: string) => tabla[t] === true,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("la negociación para WhatsApp NO cae en Opus-dentro-de-MP4", () => {
  it("Chromium elige WebM/Opus, que el servidor reenvasa a Ogg", () => {
    conSoporte(CHROMIUM);
    expect(pickMimeType(true)).toBe("audio/webm;codecs=opus");
  });

  it("Firefox elige Ogg/Opus directo: ni siquiera hace falta reenvasar", () => {
    conSoporte(FIREFOX);
    expect(pickMimeType(true)).toBe("audio/ogg;codecs=opus");
  });

  it("Safari sigue cayendo en MP4 — el suyo es AAC y Meta lo acepta", () => {
    conSoporte(SAFARI);
    expect(pickMimeType(true)).toBe("audio/mp4");
  });

  it("sin ningún formato soportado no se inventa uno", () => {
    conSoporte({});
    expect(pickMimeType(true)).toBeNull();
  });
});

describe("el orden de la lista es la garantía, y se fija acá", () => {
  it("`audio/mp4` va ÚLTIMO: es el recurso de Safari, no la primera opción", () => {
    const lista = [...MIME_PREFERIDOS_WHATSAPP];
    expect(lista[lista.length - 1]).toBe("audio/mp4");
  });

  it("todo formato basado en Opus va ANTES que mp4", () => {
    const lista: string[] = [...MIME_PREFERIDOS_WHATSAPP];
    const mp4 = lista.indexOf("audio/mp4");
    for (const opus of ["audio/ogg;codecs=opus", "audio/webm;codecs=opus"]) {
      expect(lista.indexOf(opus), opus).toBeGreaterThanOrEqual(0);
      expect(lista.indexOf(opus), opus).toBeLessThan(mp4);
    }
  });

  it("mp4 no se saca de la lista: sacarlo dejaría a Safari sin mensajes de voz", () => {
    expect([...MIME_PREFERIDOS_WHATSAPP]).toContain("audio/mp4");
  });
});
