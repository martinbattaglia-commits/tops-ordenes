/**
 * H-7 · el media ENTRANTE de WhatsApp. Lógica pura, sin IO.
 *
 * `parseInboundPayload` aceptaba `type === "text"` y descartaba todo lo demás
 * contra el contador `skipped.nonText`, que no se persistía en ninguna parte.
 * Consecuencia medida en producción: entre el 13 y el 18 de agosto de 2026
 * llegaron 6 documentos, 5 imágenes y 3 audios de clientes —14 mensajes— y
 * Nexus los tiró sin dejar rastro visible. El operador no veía que existieran.
 *
 * Este módulo describe QUÉ es un media entrante a partir del payload de Meta.
 * La descarga y el guardado viven en el adaptador, igual que en el saliente: acá
 * no hay red ni storage, y por eso se puede medir contra fixtures reales.
 *
 * Las formas están tomadas de los payloads REALES almacenados en
 * `wa_inbound_events`, no de la documentación:
 *   image    → { id, mime_type, sha256, url, caption? }
 *   document → { id, mime_type, sha256, url, filename }
 *   audio    → { id, mime_type, sha256, url, voice }
 *
 * `url` viene en el payload pero NO se usa: es un enlace del CDN de Meta que
 * exige el token igual, caduca, y confiar en una URL que llega dentro del
 * evento sería tomar por buena la ubicación que declara el remitente. El
 * `id` se resuelve contra la Graph API, que es la misma vía que ya usa el
 * saliente.
 */

/** Familia del media entrante. `sticker` y `video` se declaran no soportados. */
export type InboundMediaKind = "image" | "document" | "audio";

export interface InboundMedia {
  kind: InboundMediaKind;
  /** Identificador de Meta. Se resuelve contra la Graph API para bajar bytes. */
  mediaId: string;
  /** MIME que DECLARA Meta. Se vuelve a verificar por firma binaria al guardar. */
  declaredMime: string | null;
  /** Nombre propuesto. Sólo los documentos lo traen. */
  fileName: string | null;
  /** Nota de voz (audio grabado) frente a un archivo de audio adjuntado. */
  voice: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

const FAMILIAS: Record<string, InboundMediaKind> = {
  image: "image",
  document: "document",
  audio: "audio",
};

/**
 * Extrae el media de un mensaje ya validado (con wamid, remitente y fecha).
 *
 * `null` significa «este mensaje no trae media que sepamos ingresar», y el
 * llamador decide qué hacer con eso. NO significa «no había nada»: un `video`
 * o un `sticker` devuelven `null` y siguen siendo información del cliente que
 * hoy no se guarda. Por eso `describeUnsupported` existe.
 */
export function extractInboundMedia(message: unknown): InboundMedia | null {
  const m = asRecord(message);
  if (!m) return null;
  const tipo = texto(m.type);
  if (!tipo) return null;
  const kind = FAMILIAS[tipo];
  if (!kind) return null;

  const cuerpo = asRecord(m[tipo]);
  if (!cuerpo) return null;
  const mediaId = texto(cuerpo.id);
  if (!mediaId) return null;

  return {
    kind,
    mediaId,
    declaredMime: texto(cuerpo.mime_type),
    fileName: texto(cuerpo.filename),
    voice: cuerpo.voice === true,
  };
}

/** Pie de foto del media, si el cliente escribió uno. */
export function extractInboundCaption(message: unknown): string | null {
  const m = asRecord(message);
  if (!m) return null;
  const tipo = texto(m.type);
  if (!tipo) return null;
  const cuerpo = asRecord(m[tipo]);
  return cuerpo ? texto(cuerpo.caption) : null;
}

/**
 * Cuerpo visible del mensaje de media.
 *
 * Con pie de foto, el pie. Sin él, una etiqueta que DICE QUÉ LLEGÓ: el hilo no
 * puede mostrar una burbuja vacía, porque el operador leería el silencio como
 * «no mandó nada» —que es exactamente lo que venía pasando—.
 */
export function inboundMediaBody(media: InboundMedia, caption: string | null): string {
  if (caption) return caption;
  if (media.kind === "audio") return media.voice ? "🎙️ Mensaje de voz" : "🎵 Audio";
  if (media.kind === "image") return "📷 Foto";
  return media.fileName ? `📎 ${media.fileName}` : "📎 Documento";
}

/**
 * Tipos que Meta puede mandar y este ingreso todavía no guarda.
 *
 * Se nombran en vez de contarse: `skipped.nonText` era un número que no salía
 * a ninguna parte, y por eso la pérdida fue invisible durante seis días.
 */
export const UNSUPPORTED_INBOUND_TYPES = [
  "video", "sticker", "location", "contacts", "reaction", "button", "interactive", "order", "system",
] as const;

export function describeUnsupported(message: unknown): string | null {
  const m = asRecord(message);
  const tipo = m ? texto(m.type) : null;
  if (!tipo || tipo === "text" || FAMILIAS[tipo]) return null;
  return tipo;
}
