/**
 * Qué hay REALMENTE adentro del contenedor de audio, antes de mandárselo a Meta.
 *
 * ─── POR QUÉ NO ALCANZA CON LA FIRMA BINARIA ──────────────────────────────
 *
 * `sniffAudio` mira los primeros bytes y responde el CONTENEDOR: un MP4 empieza
 * con `....ftyp` lleve AAC o lleve Opus. Meta acepta `audio/mp4` esperando AAC;
 * Chromium produce Opus dentro de MP4 y declara el mismo MIME. Ninguna
 * comprobación de las que había podía distinguirlos.
 *
 * El precio de no distinguirlos era alto porque el rechazo es ASINCRÓNICO: Meta
 * aceptaba la subida, devolvía el `media_id`, aceptaba el envío, devolvía el
 * `wamid` — y recién horas después, por webhook, contestaba 131053 con
 * «uploaded with mimetype as audio/mp4, however on processing it is of type
 * application/octet-stream». Para el operador, el mensaje había salido bien.
 *
 * Un rechazo propio en el momento, que nombre lo producido y lo esperado, vale
 * más que ese 131053 tardío. Este módulo es lógica pura, sin IO.
 */

/** Contenedores de audio que este verificador sabe leer. */
export type AudioContainer = "mp4" | "ogg" | "webm" | "mpeg" | null;

export interface AudioPayloadInfo {
  container: AudioContainer;
  /**
   * Códec REAL. En MP4 es el formato del sample entry (`Opus`, `mp4a`…), leído
   * del `stsd`; en Ogg se deriva de la cabecera. `null` = no se pudo determinar,
   * que NO es lo mismo que «no hay».
   */
  codec: string | null;
}

const A = (b: Uint8Array, i: number, s: string) =>
  b.length >= i + s.length && s.split("").every((c, k) => b[i + k] === c.charCodeAt(0));

/**
 * Recorre las cajas ISO-BMFF hasta el `stsd` y devuelve el formato de su primera
 * entrada.
 *
 * Es el mismo recorrido con el que se diagnosticó el binario rechazado en
 * producción. Sólo desciende por los contenedores que llevan al `stsd`, y se
 * detiene ante cualquier tamaño inconsistente en vez de seguir adivinando: un
 * archivo truncado tiene que responder «no sé», nunca un códec inventado.
 */
function codecDeMp4(b: Uint8Array): string | null {
  const CONTENEDORAS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);

  // ─── C4 · LOS DOS TOPES QUE ACOTAN AL PARSER ──────────────────────────────
  //
  // La recursión sin límite incumplía el contrato de este mismo docblock: un
  // MP4 con `moov` anidado 50.000 veces —8 bytes por nivel, ~400 KB, muy por
  // debajo del tope de 25 MB del adjunto— reventaba la pila con `RangeError`
  // en vez de responder «no sé». Y la excepción subía por la Server Action,
  // porque el llamador confía en que esto NO lanza.
  //
  // El camino legítimo hasta el `stsd` usa 5 niveles (moov›trak›mdia›minf›stbl);
  // 16 deja margen para muxers exóticos sin dejar margen para el ataque. El
  // tope de iteraciones cubre el otro eje —miles de cajas hermanas— que la
  // profundidad sola no acota.
  const MAX_PROFUNDIDAD = 16;
  const MAX_CAJAS = 10_000;
  let cajasVistas = 0;

  const recorrer = (ini: number, fin: number, profundidad: number): string | null => {
    if (profundidad > MAX_PROFUNDIDAD) return null;
    let off = ini;
    while (off + 8 <= fin) {
      if (++cajasVistas > MAX_CAJAS) return null;
      let size = dv.getUint32(off);
      let hdr = 8;
      if (size === 1) {
        if (off + 16 > fin) return null;
        size = Number(dv.getBigUint64(off + 8));
        hdr = 16;
      }
      if (size === 0) size = fin - off;
      if (size < hdr || off + size > fin) return null; // truncado o corrupto
      const tipo = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);

      if (tipo === "stsd") {
        // stsd: versión+flags (4) · entry_count (4) · [ size (4) · format (4) ]
        const fmt = off + hdr + 12;
        if (fmt + 4 > fin) return null;
        return String.fromCharCode(b[fmt], b[fmt + 1], b[fmt + 2], b[fmt + 3]);
      }
      if (CONTENEDORAS.has(tipo)) {
        const hallado = recorrer(off + hdr, off + size, profundidad + 1);
        if (hallado) return hallado;
      }
      off += size;
    }
    return null;
  };

  return recorrer(0, b.length, 0);
}

export function inspectAudioPayload(bytes: Uint8Array): AudioPayloadInfo {
  if (bytes.length < 12) return { container: null, codec: null };

  if (A(bytes, 0, "OggS")) {
    // El `OpusHead` va al principio del primer paquete; con la primera página
    // alcanza para saber si es Opus.
    const cabeza = bytes.subarray(0, Math.min(bytes.length, 128));
    let opus = false;
    for (let i = 0; i + 8 <= cabeza.length; i++) {
      if (A(cabeza, i, "OpusHead")) { opus = true; break; }
    }
    return { container: "ogg", codec: opus ? "opus" : null };
  }
  if (A(bytes, 4, "ftyp")) return { container: "mp4", codec: codecDeMp4(bytes) };
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { container: "webm", codec: null };
  }
  if (A(bytes, 0, "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { container: "mpeg", codec: "mp3" };
  }
  return { container: null, codec: null };
}

export type MetaAudioCheck = { ok: true } | { ok: false; message: string };

/**
 * Sample entries de MP4 que Meta procesa. Es AAC y nada más: `mp4a` es el
 * formato genérico de AAC en ISO-BMFF, y las variantes `.mp4a` aparecen en
 * algunos muxers.
 */
const MP4_ACEPTADOS = new Set(["mp4a", ".mp4"]);

/**
 * Última compuerta antes del egress: ¿este binario es uno que Meta reproduce?
 *
 * Sólo juzga audio. Imágenes y documentos tienen su propia admisión en
 * `checkWhatsappMedia`, y meterlos acá duplicaría la autoridad.
 */
export function checkMetaAudioPayload(bytes: Uint8Array, mimeType: string): MetaAudioCheck {
  if (!mimeType.split(";")[0].trim().toLowerCase().startsWith("audio/")) return { ok: true };

  const info = inspectAudioPayload(bytes);

  if (info.container === "mp4") {
    if (info.codec && MP4_ACEPTADOS.has(info.codec)) return { ok: true };
    const producido = info.codec ?? "desconocido";
    return {
      ok: false,
      message:
        `El audio se grabó como ${producido} dentro de un contenedor MP4, y WhatsApp ` +
        "sólo reproduce MP4 con AAC. Probá desde otro navegador o volvé a grabarlo.",
    };
  }
  if (info.container === "ogg") {
    return info.codec === "opus"
      ? { ok: true }
      : { ok: false, message: "El audio Ogg no lleva Opus, que es lo único que WhatsApp reproduce." };
  }
  if (info.container === "mpeg") return { ok: true };
  if (info.container === "webm") {
    // No debería llegar acá: el reenvasado corre antes. Si llegara, WhatsApp
    // no reproduce WebM y decirlo es mejor que dejar que Meta lo rechace tarde.
    return { ok: false, message: "El audio quedó en WebM, que WhatsApp no reproduce." };
  }
  return {
    ok: false,
    message: "No se pudo determinar el formato real del audio, así que no se envía.",
  };
}
