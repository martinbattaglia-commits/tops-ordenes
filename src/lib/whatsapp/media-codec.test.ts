// El guarda que mira ADENTRO del contenedor antes de mandarle nada a Meta.
//
// Meta acepta `audio/mp4` esperando AAC. Chromium produce Opus dentro de MP4 y
// declara el mismo MIME, así que ninguna comprobación basada en el tipo
// declarado —ni la firma binaria del contenedor— podía distinguirlos: los dos
// empiezan con `....ftyp`. El rechazo llegaba ASINCRÓNICO, por webhook, horas
// después de que Meta ya había aceptado la subida y devuelto el wamid.
//
// Un rechazo propio en el momento, que diga qué se produjo y qué se esperaba,
// vale más que un 131053 tardío y genérico.

import { describe, it, expect } from "vitest";
import { inspectAudioPayload, checkMetaAudioPayload } from "./media-codec";

// ── Constructor de MP4 mínimos con la MISMA estructura del binario real ─────
const enc = new TextEncoder();
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0));
  let k = 0; for (const x of p) { o.set(x, k); k += x.length; }
  return o;
};
const be32 = (n: number) => new Uint8Array([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
const box = (tipo: string, ...hijos: Uint8Array[]) => {
  const cuerpo = cat(...hijos);
  return cat(be32(cuerpo.length + 8), enc.encode(tipo), cuerpo);
};
/** `stsd` con UNA entrada cuyo formato es el códec dado. */
const stsd = (codec: string) =>
  box("stsd", be32(0), be32(1), cat(be32(16), enc.encode(codec), new Uint8Array(8)));
const mp4Con = (codec: string) =>
  cat(
    box("ftyp", enc.encode("isom"), be32(0x200), enc.encode("isomvp09")),
    box("moov", box("trak", box("mdia",
      cat(be32(20), enc.encode("hdlr"), be32(0), be32(0), enc.encode("soun")),
      box("minf", box("stbl", stsd(codec))),
    ))),
  );

/** Ogg/Opus, que es lo que WhatsApp usa y lo que produce el reenvasado. */
const OGG = cat(enc.encode("OggS"), new Uint8Array(22), enc.encode("OpusHead"));

describe("se mira el CÓDEC, no el contenedor", () => {
  it("un MP4 con Opus adentro se identifica como tal", () => {
    expect(inspectAudioPayload(mp4Con("Opus"))).toEqual({
      container: "mp4", codec: "Opus",
    });
  });

  it("un MP4 con AAC también, y son distinguibles", () => {
    expect(inspectAudioPayload(mp4Con("mp4a"))).toEqual({
      container: "mp4", codec: "mp4a",
    });
  });

  it("Ogg se reconoce sin necesidad de recorrer cajas", () => {
    expect(inspectAudioPayload(OGG)).toEqual({ container: "ogg", codec: "opus" });
  });

  it("lo que no es audio conocido se declara desconocido, no se adivina", () => {
    expect(inspectAudioPayload(new Uint8Array(32))).toEqual({
      container: null, codec: null,
    });
  });

  it("un MP4 truncado no explota ni miente", () => {
    const cortado = mp4Con("Opus").subarray(0, 30);
    expect(() => inspectAudioPayload(cortado)).not.toThrow();
    expect(inspectAudioPayload(cortado).codec).toBeNull();
  });
});

describe("el guarda rechaza ANTES de mandar, y dice por qué", () => {
  it("Opus-dentro-de-MP4 se rechaza: es EXACTAMENTE lo que Meta devolvió con 131053", () => {
    const r = checkMetaAudioPayload(mp4Con("Opus"), "audio/mp4");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // El mensaje tiene que nombrar lo producido Y lo esperado: sin eso, el
    // operador vuelve a reportar «no anda» y perdemos otros dos días.
    expect(r.message).toContain("Opus");
    expect(r.message).toContain("AAC");
  });

  it("MP4 con AAC pasa: es el de Safari, y Meta lo acepta", () => {
    expect(checkMetaAudioPayload(mp4Con("mp4a"), "audio/mp4").ok).toBe(true);
  });

  it("Ogg/Opus pasa: es el formato del propio WhatsApp", () => {
    expect(checkMetaAudioPayload(OGG, "audio/ogg").ok).toBe(true);
  });

  it("lo que no es audio no lo juzga este guarda", () => {
    // Imágenes y documentos tienen su propia admisión en `checkWhatsappMedia`.
    expect(checkMetaAudioPayload(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg").ok).toBe(true);
  });

  it("un audio cuyo contenedor no se puede leer se rechaza, no se manda a ver qué pasa", () => {
    const r = checkMetaAudioPayload(new Uint8Array(32), "audio/mp4");
    expect(r.ok).toBe(false);
  });
});
