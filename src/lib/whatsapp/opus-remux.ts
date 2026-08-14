// Nexus Link · FASE B — WebM/Opus → Ogg/Opus. PURO, sin IO, sin dependencias.
//
// ─── EL PROBLEMA QUE RESUELVE ──────────────────────────────────────────────
//
// WhatsApp no reproduce WebM. Chrome y Android graban en WebM y no ofrecen otra
// cosa: `MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")` es `false` ahí,
// y `audio/mp4` tampoco está disponible de forma confiable. Con la negociación
// sola, un mensaje de voz grabado desde Android no se puede mandar — y avisarle
// al operador que no se puede NO es resolverlo.
//
// ─── POR QUÉ ESTO NO ES UNA CONVERSIÓN ─────────────────────────────────────
//
// Es la clave de que se pueda hacer en unas pocas decenas de líneas y sin
// ffmpeg: WebM y Ogg son CONTENEDORES distintos del MISMO códec. El audio que
// graba Chrome ya es Opus; lo único que difiere es el envoltorio. Acá se abre
// el envoltorio de Matroska, se sacan los paquetes Opus TAL CUAL y se los
// vuelve a envolver en páginas Ogg.
//
// No se decodifica ni se re-codifica nada: los bytes de audio que salen son
// bit a bit los que entraron. Cero pérdida de calidad, cero costo de CPU
// significativo, cero dependencia binaria.
//
// ─── DÓNDE CORRE ───────────────────────────────────────────────────────────
//
// En el SERVIDOR, sobre el objeto ya subido y ya validado por firma. El
// navegador entrega lo que puede entregar; el servidor traduce. Así el arreglo
// vive en un solo lugar, no depende de qué navegador use cada operador, y se
// puede probar con bytes reales en Node.
//
// El chat interno sigue recibiendo el WebM original: los navegadores lo
// reproducen sin problema y no hay motivo para tocarlo.

// ═══════════════════════════ EBML / Matroska ═══════════════════════════════

/** IDs que hay que atravesar para llegar al audio. */
const MASTERS = new Set([
  0x18538067, // Segment
  0x1654ae6b, // Tracks
  0xae,       // TrackEntry
  0x1f43b675, // Cluster
  0xa0,       // BlockGroup
]);
const ID_CODEC_ID = 0x86;
const ID_CODEC_PRIVATE = 0x63a2;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK = 0xa1;

/** Longitud declarada por los bits de marca de un vint. 0 = inválido. */
function vintLength(b0: number): number {
  for (let i = 0; i < 8; i++) if (b0 & (0x80 >> i)) return i + 1;
  return 0;
}

interface Vint { value: number; length: number; unknown: boolean }

/** Lee un vint de TAMAÑO (marca removida). */
function readSize(b: Uint8Array, pos: number): Vint | null {
  if (pos >= b.length) return null;
  const len = vintLength(b[pos]);
  if (len === 0 || pos + len > b.length) return null;
  let value = b[pos] & (0xff >> len);
  let todoUnos = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) todoUnos = false;
  }
  return { value, length: len, unknown: todoUnos };
}

/** Lee un vint de ID (conserva la marca: así se comparan los IDs canónicos). */
function readId(b: Uint8Array, pos: number): Vint | null {
  if (pos >= b.length) return null;
  const len = vintLength(b[pos]);
  if (len === 0 || pos + len > b.length) return null;
  let value = 0;
  for (let i = 0; i < len; i++) value = value * 256 + b[pos + i];
  return { value, length: len, unknown: false };
}

export interface WebmOpusContenido {
  /** `OpusHead` del CodecPrivate: se copia sin tocar a la primera página Ogg. */
  opusHead: Uint8Array;
  /** Paquetes Opus en orden, tal como venían dentro de los bloques. */
  paquetes: Uint8Array[];
}

export type ExtraccionResultado =
  | { ok: true; contenido: WebmOpusContenido }
  | { ok: false; message: string };

/**
 * Recorre el WebM y saca los paquetes Opus.
 *
 * El recorrido es PLANO a propósito: al toparse con un master se avanza sólo
 * sobre su cabecera y se sigue leyendo a sus hijos en secuencia. Suena
 * simplista, pero es justo lo que hace falta acá — MediaRecorder emite Segment
 * (y a veces Cluster) con TAMAÑO DESCONOCIDO, porque no sabe cuánto va a durar
 * la grabación cuando escribe la cabecera. Un recorrido recursivo que confíe en
 * los tamaños se cae con esa salida; éste ni se entera.
 */
export function extraerOpusDeWebm(bytes: Uint8Array): ExtraccionResultado {
  let opusHead: Uint8Array | null = null;
  let codec: string | null = null;
  const paquetes: Uint8Array[] = [];

  let pos = 0;
  while (pos < bytes.length) {
    const id = readId(bytes, pos);
    if (!id) break;
    const size = readSize(bytes, pos + id.length);
    if (!size) break;
    const cuerpo = pos + id.length + size.length;

    if (MASTERS.has(id.value)) {
      pos = cuerpo; // se desciende: los hijos siguen en secuencia
      continue;
    }
    if (size.unknown) break; // un no-master de tamaño desconocido es basura
    const fin = cuerpo + size.value;
    if (fin > bytes.length) break;

    if (id.value === ID_CODEC_ID) {
      codec = new TextDecoder("utf-8").decode(bytes.subarray(cuerpo, fin)).replace(/\0+$/, "");
    } else if (id.value === ID_CODEC_PRIVATE) {
      opusHead = bytes.subarray(cuerpo, fin);
    } else if (id.value === ID_SIMPLE_BLOCK || id.value === ID_BLOCK) {
      const p = leerBloque(bytes, cuerpo, fin);
      if (!p) return { ok: false, message: "El audio usa un empaquetado que no se puede releer." };
      paquetes.push(p);
    }
    pos = fin;
  }

  if (codec !== null && codec !== "A_OPUS") {
    return { ok: false, message: `El audio no es Opus (${codec}).` };
  }
  if (!opusHead || opusHead.length < 19) {
    return { ok: false, message: "El audio no declara su cabecera Opus." };
  }
  if (paquetes.length === 0) {
    return { ok: false, message: "El audio no tiene contenido." };
  }
  return { ok: true, contenido: { opusHead, paquetes } };
}

/**
 * Carga útil de un SimpleBlock/Block: número de pista, timecode, flags y datos.
 *
 * Se rechaza el LACING —varios frames en un bloque—: MediaRecorder no lo usa
 * para Opus, y adivinar cómo desarmarlo sin un caso real que lo verifique sería
 * escribir código que nadie probó. Fallar acá es honesto; salir con audio
 * cortado no lo sería.
 */
function leerBloque(b: Uint8Array, inicio: number, fin: number): Uint8Array | null {
  const pista = readSize(b, inicio);
  if (!pista) return null;
  const p = inicio + pista.length + 2 /* timecode int16 */;
  if (p >= fin) return null;
  const flags = b[p];
  const lacing = (flags >> 1) & 0x03;
  if (lacing !== 0) return null;
  return b.subarray(p + 1, fin);
}

// ═══════════════════════════ duración de Opus ══════════════════════════════

/** Muestras a 48 kHz por trama, según el byte TOC. */
const SILK_O_CELT = [480, 960, 1920, 2880];
const CELT = [120, 240, 480, 960];

/**
 * Muestras que representa un paquete Opus, a 48 kHz.
 *
 * Hace falta para el `granule_position` de Ogg, que es lo que le dice al
 * reproductor cuánto dura el audio. Con un granule mal calculado WhatsApp
 * muestra el mensaje con una duración equivocada —o directamente no lo
 * reproduce—, así que sale del byte TOC y no de una estimación.
 */
export function muestrasDePaqueteOpus(paquete: Uint8Array): number {
  if (paquete.length === 0) return 0;
  const toc = paquete[0];
  const config = toc >> 3;
  const code = toc & 0x03;

  let porTrama: number;
  if (config < 12) porTrama = SILK_O_CELT[config & 0x03];       // SILK
  else if (config < 16) porTrama = (config & 0x01) ? 960 : 480; // híbrido
  else porTrama = CELT[config & 0x03];                          // CELT

  let tramas: number;
  if (code === 0) tramas = 1;
  else if (code === 1 || code === 2) tramas = 2;
  else tramas = paquete.length > 1 ? paquete[1] & 0x3f : 0;     // code 3
  return porTrama * tramas;
}

// ═══════════════════════════ escritura de Ogg ══════════════════════════════

/** CRC de Ogg: polinomio 0x04c11db7, sin reflexión, init 0, sin xor final. */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    t[i] = r >>> 0;
  }
  return t;
})();

export function crcOgg(datos: Uint8Array): number {
  let crc = 0;
  for (const b of datos) crc = ((crc << 8) ^ TABLA_CRC[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** Tabla de lacing de un paquete: tantos 255 como haga falta, y el resto. */
function lacingDe(largo: number): number[] {
  const segs: number[] = [];
  let resto = largo;
  while (resto >= 255) { segs.push(255); resto -= 255; }
  segs.push(resto);
  return segs;
}

interface PaginaOgg {
  paquetes: Uint8Array[];
  granule: number;
  bos: boolean;
  eos: boolean;
  secuencia: number;
  serial: number;
}

function escribirPagina(p: PaginaOgg): Uint8Array {
  const segmentos: number[] = [];
  for (const paq of p.paquetes) segmentos.push(...lacingDe(paq.length));
  const cuerpoLargo = p.paquetes.reduce((a, x) => a + x.length, 0);
  const pagina = new Uint8Array(27 + segmentos.length + cuerpoLargo);
  const dv = new DataView(pagina.buffer);

  pagina.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  pagina[4] = 0;                            // versión
  pagina[5] = (p.bos ? 0x02 : 0) | (p.eos ? 0x04 : 0);
  // `granule_position` es int64 LE. Se parte en dos de 32 porque el audio de un
  // mensaje de voz jamás llega al techo de 32 bits (≈ 24 h a 48 kHz).
  dv.setUint32(6, p.granule >>> 0, true);
  dv.setUint32(10, Math.floor(p.granule / 0x100000000), true);
  dv.setUint32(14, p.serial, true);
  dv.setUint32(18, p.secuencia, true);
  dv.setUint32(22, 0, true);                // CRC en cero para calcularlo
  pagina[26] = segmentos.length;
  pagina.set(segmentos, 27);
  let off = 27 + segmentos.length;
  for (const paq of p.paquetes) { pagina.set(paq, off); off += paq.length; }

  dv.setUint32(22, crcOgg(pagina), true);
  return pagina;
}

/** `OpusTags` mínimo y válido: vendor propio y cero comentarios. */
function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("nexus-link");
  const out = new Uint8Array(8 + 4 + vendor.length + 4);
  out.set(new TextEncoder().encode("OpusTags"), 0);
  new DataView(out.buffer).setUint32(8, vendor.length, true);
  out.set(vendor, 12);
  new DataView(out.buffer).setUint32(12 + vendor.length, 0, true);
  return out;
}

/** Tope de segmentos por página que impone el formato Ogg. */
const MAX_SEGMENTOS = 255;

export type RemuxResultado =
  | { ok: true; bytes: Uint8Array; muestras: number }
  | { ok: false; message: string };

/**
 * Reenvasa un WebM/Opus como Ogg/Opus.
 *
 * `serial` es el identificador del flujo Ogg. Se recibe por parámetro —en vez
 * de sortearlo acá adentro— para que la función siga siendo PURA y su salida
 * reproducible byte a byte: una función que sortea no se puede comparar contra
 * un vector conocido.
 */
export function remuxWebmOpusAOgg(bytes: Uint8Array, serial = 0x4e455855): RemuxResultado {
  const extraido = extraerOpusDeWebm(bytes);
  if (!extraido.ok) return { ok: false, message: extraido.message };
  const { opusHead, paquetes } = extraido.contenido;

  const paginas: Uint8Array[] = [];
  let secuencia = 0;
  // Las dos cabeceras van SOLAS en su página, con granule 0: lo exige el mapeo
  // de Opus en Ogg, y un reproductor estricto rechaza el flujo si se mezclan.
  paginas.push(escribirPagina({
    paquetes: [opusHead], granule: 0, bos: true, eos: false, secuencia: secuencia++, serial,
  }));
  paginas.push(escribirPagina({
    paquetes: [opusTags()], granule: 0, bos: false, eos: false, secuencia: secuencia++, serial,
  }));

  let granule = 0;
  let lote: Uint8Array[] = [];
  let segmentosDelLote = 0;
  const emitir = (eos: boolean) => {
    if (lote.length === 0) return;
    paginas.push(escribirPagina({
      paquetes: lote, granule, bos: false, eos, secuencia: secuencia++, serial,
    }));
    lote = [];
    segmentosDelLote = 0;
  };

  for (let i = 0; i < paquetes.length; i++) {
    const paq = paquetes[i];
    const segs = lacingDe(paq.length).length;
    if (segmentosDelLote + segs > MAX_SEGMENTOS) emitir(false);
    lote.push(paq);
    segmentosDelLote += segs;
    granule += muestrasDePaqueteOpus(paq);
    if (i === paquetes.length - 1) emitir(true);
  }
  // Un solo paquete que no entró en ninguna página sería un flujo sin EOS.
  if (lote.length > 0) emitir(true);

  const total = paginas.reduce((a, p) => a + p.length, 0);
  const salida = new Uint8Array(total);
  let off = 0;
  for (const p of paginas) { salida.set(p, off); off += p.length; }
  return { ok: true, bytes: salida, muestras: granule };
}

/** ¿Este MIME necesita reenvasarse para poder mandarse por WhatsApp? */
export function necesitaRemuxParaWhatsapp(mime: string): boolean {
  return mime.split(";")[0].trim().toLowerCase() === "audio/webm";
}
