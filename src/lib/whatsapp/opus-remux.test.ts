// Nexus Link · FASE B — WebM/Opus → Ogg/Opus.
//
// El WebM de entrada se construye byte a byte con la MISMA forma que emite
// `MediaRecorder`: Segment de tamaño DESCONOCIDO, Clusters encadenados y
// SimpleBlocks sin lacing. Si el lector sólo funcionara con archivos de tamaño
// declarado, pasaría todas las pruebas y fallaría con el único productor que
// nos importa.
//
// La salida se verifica con un lector de Ogg escrito ACÁ, independiente del
// escritor: recalcula el CRC de cada página y reensambla los paquetes desde la
// tabla de lacing. Comparar el escritor contra sí mismo no probaría nada.

import { describe, expect, it } from "vitest";
import {
  crcOgg, extraerOpusDeWebm, muestrasDePaqueteOpus, necesitaRemuxParaWhatsapp,
  remuxWebmOpusAOgg,
} from "./opus-remux";

// ───────────────────────── constructor de WebM ─────────────────────────────

const b = (...n: number[]) => new Uint8Array(n);
const concat = (...partes: Uint8Array[]) => {
  const out = new Uint8Array(partes.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
};

/** Vint de tamaño de 8 bytes: vale para cualquier longitud y simplifica. */
function size8(n: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7; i >= 1; i--) { out[i] = n & 0xff; n = Math.floor(n / 256); }
  return out;
}
const SIZE_DESCONOCIDO = b(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);

const elem = (id: number[], payload: Uint8Array) => concat(b(...id), size8(payload.length), payload);
const master = (id: number[], payload: Uint8Array) => elem(id, payload);
const masterAbierto = (id: number[]) => concat(b(...id), SIZE_DESCONOCIDO);

/** `OpusHead` mínimo y válido: 19 bytes, 1 canal, 48 kHz. */
const OPUS_HEAD = concat(
  new TextEncoder().encode("OpusHead"),
  b(1, 1),                     // versión, canales
  b(0x38, 0x01),               // pre-skip 312 LE
  b(0x80, 0xbb, 0x00, 0x00),   // 48000 Hz LE
  b(0, 0, 0),                  // ganancia, mapping
);

/**
 * Paquete Opus sintético de 20 ms.
 *
 * TOC 0xFC = config 31 (CELT fullband 20 ms), estéreo, code 0 (una trama) ⇒
 * 960 muestras a 48 kHz, que es exactamente lo que graba Chrome.
 */
const paquete = (relleno: number, largo = 40) =>
  concat(b(0xfc), new Uint8Array(largo - 1).fill(relleno));

const simpleBlock = (datos: Uint8Array, pista = 1) =>
  elem([0xa3], concat(b(0x80 | pista), b(0x00, 0x00), b(0x00), datos));

function webmCon(paquetes: Uint8Array[], opts: {
  codec?: string; sinCodecPrivate?: boolean; lacing?: boolean;
} = {}): Uint8Array {
  const pistas = master([0x16, 0x54, 0xae, 0x6b], master([0xae], concat(
    elem([0xd7], b(1)),
    elem([0x86], new TextEncoder().encode(opts.codec ?? "A_OPUS")),
    ...(opts.sinCodecPrivate ? [] : [elem([0x63, 0xa2], OPUS_HEAD)]),
  )));
  const bloques = paquetes.map((p) => (opts.lacing
    // flags con lacing Xiph (0x02): se rechaza a propósito.
    ? elem([0xa3], concat(b(0x81), b(0x00, 0x00), b(0x02), b(1), p))
    : simpleBlock(p)));
  return concat(
    elem([0x1a, 0x45, 0xdf, 0xa3], b(0x42, 0x86, 0x81, 0x01)), // cabecera EBML
    masterAbierto([0x18, 0x53, 0x80, 0x67]),                   // Segment: SIN tamaño
    pistas,
    masterAbierto([0x1f, 0x43, 0xb6, 0x75]),                   // Cluster: SIN tamaño
    elem([0xe7], b(0x00)),                                     // Timecode
    ...bloques,
  );
}

// ───────────────────── lector de Ogg, independiente ────────────────────────

interface PaginaLeida { bos: boolean; eos: boolean; granule: number; secuencia: number; paquetes: Uint8Array[] }

/** Parsea Ogg validando el CRC de cada página por recálculo. */
function leerOgg(bytes: Uint8Array): PaginaLeida[] {
  const paginas: PaginaLeida[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    expect(String.fromCharCode(...bytes.subarray(pos, pos + 4))).toBe("OggS");
    const dv = new DataView(bytes.buffer, bytes.byteOffset + pos);
    const tipo = bytes[pos + 5];
    const granule = dv.getUint32(6, true) + dv.getUint32(10, true) * 0x100000000;
    const secuencia = dv.getUint32(18, true);
    const crcDeclarado = dv.getUint32(22, true);
    const nSegs = bytes[pos + 26];
    const tabla = bytes.subarray(pos + 27, pos + 27 + nSegs);
    const cuerpoLargo = tabla.reduce((a, x) => a + x, 0);
    const largoPagina = 27 + nSegs + cuerpoLargo;

    // CRC recalculado sobre la página con el campo en cero.
    const copia = bytes.slice(pos, pos + largoPagina);
    new DataView(copia.buffer).setUint32(22, 0, true);
    expect(crcOgg(copia)).toBe(crcDeclarado);

    const cuerpo = bytes.subarray(pos + 27 + nSegs, pos + largoPagina);
    const paquetes: Uint8Array[] = [];
    let acumulado = 0, off = 0;
    for (const s of tabla) {
      acumulado += s;
      if (s < 255) { paquetes.push(cuerpo.subarray(off, off + acumulado)); off += acumulado; acumulado = 0; }
    }
    paginas.push({ bos: (tipo & 0x02) !== 0, eos: (tipo & 0x04) !== 0, granule, secuencia, paquetes });
    pos += largoPagina;
  }
  return paginas;
}

const texto = (u: Uint8Array, n: number) => String.fromCharCode(...u.subarray(0, n));

// ═══════════════════════════ extracción ════════════════════════════════════

describe("extraerOpusDeWebm", () => {
  it("lee los paquetes de un WebM con Segment y Cluster de tamaño DESCONOCIDO", () => {
    const r = extraerOpusDeWebm(webmCon([paquete(1), paquete(2), paquete(3)]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contenido.paquetes).toHaveLength(3);
      expect(texto(r.contenido.opusHead, 8)).toBe("OpusHead");
      expect(r.contenido.paquetes[1][1]).toBe(2); // el relleno identifica al paquete
    }
  });

  it("rechaza un códec que no sea Opus", () => {
    const r = extraerOpusDeWebm(webmCon([paquete(1)], { codec: "A_VORBIS" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no es Opus/);
  });

  it("rechaza si falta la cabecera Opus", () => {
    const r = extraerOpusDeWebm(webmCon([paquete(1)], { sinCodecPrivate: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/cabecera Opus/);
  });

  it("rechaza el lacing en vez de adivinar cómo desarmarlo", () => {
    const r = extraerOpusDeWebm(webmCon([paquete(1)], { lacing: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/empaquetado/);
  });

  it("rechaza un WebM sin bloques", () => {
    expect(extraerOpusDeWebm(webmCon([])).ok).toBe(false);
  });

  it("no explota con basura", () => {
    for (const basura of [new Uint8Array(0), b(1, 2, 3), new Uint8Array(64).fill(0xff)]) {
      expect(extraerOpusDeWebm(basura).ok).toBe(false);
    }
  });
});

// ═══════════════════════════ duración ══════════════════════════════════════

describe("muestrasDePaqueteOpus · sale del byte TOC, no de una estimación", () => {
  const toc = (config: number, code = 0) => b((config << 3) | code);

  it("SILK: 10, 20, 40 y 60 ms", () => {
    expect(muestrasDePaqueteOpus(toc(0))).toBe(480);
    expect(muestrasDePaqueteOpus(toc(1))).toBe(960);
    expect(muestrasDePaqueteOpus(toc(2))).toBe(1920);
    expect(muestrasDePaqueteOpus(toc(3))).toBe(2880);
  });

  it("híbrido: 10 y 20 ms", () => {
    expect(muestrasDePaqueteOpus(toc(12))).toBe(480);
    expect(muestrasDePaqueteOpus(toc(13))).toBe(960);
  });

  it("CELT: 2,5, 5, 10 y 20 ms", () => {
    expect(muestrasDePaqueteOpus(toc(16))).toBe(120);
    expect(muestrasDePaqueteOpus(toc(17))).toBe(240);
    expect(muestrasDePaqueteOpus(toc(18))).toBe(480);
    expect(muestrasDePaqueteOpus(toc(31))).toBe(960); // el que graba Chrome
  });

  it("cuenta las tramas del paquete, no sólo su tipo", () => {
    expect(muestrasDePaqueteOpus(toc(31, 1))).toBe(1920); // dos tramas
    expect(muestrasDePaqueteOpus(toc(31, 2))).toBe(1920);
    expect(muestrasDePaqueteOpus(concat(toc(31, 3), b(5)))).toBe(4800); // cinco
  });

  it("un paquete vacío no aporta duración", () => {
    expect(muestrasDePaqueteOpus(new Uint8Array(0))).toBe(0);
  });
});

// ═══════════════════════════ CRC ═══════════════════════════════════════════

describe("crcOgg", () => {
  it("es sensible a cada byte y a su posición", () => {
    const a = crcOgg(b(1, 2, 3, 4));
    expect(crcOgg(b(1, 2, 3, 5))).not.toBe(a);
    expect(crcOgg(b(4, 3, 2, 1))).not.toBe(a);
    expect(crcOgg(new Uint8Array(0))).toBe(0);
  });
});

// ═══════════════════════════ el reenvasado ═════════════════════════════════

describe("remuxWebmOpusAOgg", () => {
  const paquetes = [paquete(1), paquete(2), paquete(3), paquete(4)];

  it("produce un Ogg cuyas páginas validan su propio CRC", () => {
    const r = remuxWebmOpusAOgg(webmCon(paquetes));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const paginas = leerOgg(r.bytes); // el lector verifica CRC por recálculo
    expect(paginas.length).toBeGreaterThanOrEqual(3);
  });

  it("las dos cabeceras van SOLAS, en orden y con granule 0", () => {
    const r = remuxWebmOpusAOgg(webmCon(paquetes));
    if (!r.ok) throw new Error(r.message);
    const [uno, dos] = leerOgg(r.bytes);
    expect(uno.bos).toBe(true);
    expect(uno.paquetes).toHaveLength(1);
    expect(texto(uno.paquetes[0], 8)).toBe("OpusHead");
    expect(uno.granule).toBe(0);
    expect(dos.bos).toBe(false);
    expect(texto(dos.paquetes[0], 8)).toBe("OpusTags");
    expect(dos.granule).toBe(0);
  });

  it("el audio sale BIT A BIT como entró: es reenvasado, no conversión", () => {
    const r = remuxWebmOpusAOgg(webmCon(paquetes));
    if (!r.ok) throw new Error(r.message);
    const salida = leerOgg(r.bytes).slice(2).flatMap((p) => p.paquetes);
    expect(salida).toHaveLength(paquetes.length);
    for (let i = 0; i < paquetes.length; i++) {
      expect(Array.from(salida[i])).toEqual(Array.from(paquetes[i]));
    }
  });

  it("el granule acumula la duración real y cierra en el total", () => {
    const r = remuxWebmOpusAOgg(webmCon(paquetes));
    if (!r.ok) throw new Error(r.message);
    expect(r.muestras).toBe(960 * paquetes.length); // 20 ms cada uno
    const audio = leerOgg(r.bytes).slice(2);
    expect(audio[audio.length - 1].granule).toBe(r.muestras);
    // Y nunca retrocede.
    let previo = -1;
    for (const p of audio) { expect(p.granule).toBeGreaterThan(previo); previo = p.granule; }
  });

  it("marca EOS SÓLO en la última página, y numera en secuencia", () => {
    const r = remuxWebmOpusAOgg(webmCon(paquetes));
    if (!r.ok) throw new Error(r.message);
    const paginas = leerOgg(r.bytes);
    expect(paginas.filter((p) => p.eos)).toHaveLength(1);
    expect(paginas[paginas.length - 1].eos).toBe(true);
    expect(paginas.map((p) => p.secuencia)).toEqual(paginas.map((_, i) => i));
  });

  it("parte en varias páginas cuando se pasa del tope de 255 segmentos", () => {
    // 300 paquetes de un segmento cada uno no entran en una sola página.
    const muchos = Array.from({ length: 300 }, (_, i) => paquete(i % 251, 40));
    const r = remuxWebmOpusAOgg(webmCon(muchos));
    if (!r.ok) throw new Error(r.message);
    const paginas = leerOgg(r.bytes);
    const audio = paginas.slice(2);
    expect(audio.length).toBeGreaterThan(1);
    expect(audio.flatMap((p) => p.paquetes)).toHaveLength(300);
    for (const p of audio) expect(p.paquetes.length).toBeLessThanOrEqual(255);
  });

  it("un paquete largo se lacea y se reensambla intacto", () => {
    // 600 bytes ⇒ dos segmentos de 255 y uno de 90.
    const largo = paquete(9, 600);
    const r = remuxWebmOpusAOgg(webmCon([largo]));
    if (!r.ok) throw new Error(r.message);
    const salida = leerOgg(r.bytes).slice(2).flatMap((p) => p.paquetes);
    expect(salida[0].length).toBe(600);
    expect(Array.from(salida[0])).toEqual(Array.from(largo));
  });

  it("es DETERMINISTA: el mismo WebM produce los mismos bytes", () => {
    const uno = remuxWebmOpusAOgg(webmCon(paquetes));
    const dos = remuxWebmOpusAOgg(webmCon(paquetes));
    if (!uno.ok || !dos.ok) throw new Error("no remuxeó");
    expect(Array.from(uno.bytes)).toEqual(Array.from(dos.bytes));
  });

  it("propaga el motivo cuando la entrada no sirve", () => {
    const r = remuxWebmOpusAOgg(webmCon([paquete(1)], { codec: "A_VORBIS" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no es Opus/);
  });
});

describe("necesitaRemuxParaWhatsapp", () => {
  it("sólo el WebM necesita reenvasarse", () => {
    expect(necesitaRemuxParaWhatsapp("audio/webm")).toBe(true);
    expect(necesitaRemuxParaWhatsapp("audio/webm;codecs=opus")).toBe(true);
    expect(necesitaRemuxParaWhatsapp("AUDIO/WEBM")).toBe(true);
    expect(necesitaRemuxParaWhatsapp("audio/mp4")).toBe(false);
    expect(necesitaRemuxParaWhatsapp("audio/ogg")).toBe(false);
  });
});
