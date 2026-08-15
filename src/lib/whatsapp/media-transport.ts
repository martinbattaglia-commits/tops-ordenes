/**
 * media-transport.ts — NEXUS LINK · FASE B · media saliente por los endpoints
 * oficiales de Meta.
 *
 * Dos pasos, en este orden y nunca al revés:
 *
 *   1. `POST /{phone_number_id}/media`     (multipart) → `media_id`
 *   2. `POST /{phone_number_id}/messages`  con ese `media_id`
 *
 * ─── POR QUÉ NO SE MANDA UN `link` ────────────────────────────────────────
 *
 * La API admite `document: { link: "https://…" }`, y sería más corto. Pero eso
 * obliga a exponer el objeto en una URL que Meta —y quien la intercepte— pueda
 * descargar sin autenticación. El bucket es privado y las URLs firmadas duran
 * cinco minutos justamente para que un adjunto no se vuelva público por
 * conveniencia. Subir el binario a Meta y referenciarlo por `media_id` mantiene
 * esa propiedad: el archivo nunca queda accesible desde afuera.
 *
 * ─── LA ASIMETRÍA ENTRE LOS DOS PASOS ─────────────────────────────────────
 *
 * `sendText` (transport.ts) distingue `accepted` / `rejected` / `ambiguous`
 * porque un resultado incierto significa que el mensaje PUDO haberle llegado al
 * cliente, y reintentarlo duplicaría algo que no se puede retirar.
 *
 * La SUBIDA no tiene ese problema: si falla de forma incierta, lo único que
 * pudo quedar es un `media_id` colgado en Meta, que caduca solo y que nadie
 * recibió. Por eso `uploadMedia` devuelve un resultado binario —subió o no— y
 * es SEGURO reintentarla. El envío, en cambio, reutiliza el contrato completo de
 * tres estados sin cambiarle una coma.
 *
 * Confundir las dos asimetrías sería el error caro: tratar la subida como
 * ambigua paralizaría envíos que nunca salieron, y tratar el envío como binario
 * duplicaría mensajes en el teléfono del cliente.
 */

import type { MetaSendOutcome } from "./transport";
import { extractWamid, isAmbiguousStatus } from "./transport";

const DEFAULT_TIMEOUT_MS = 30_000; // más que texto: acá viaja el binario
const GRAPH = "https://graph.facebook.com/v22.0";

export type MetaMediaKind = "image" | "document" | "audio";

export type MetaUploadOutcome =
  | { kind: "uploaded"; mediaId: string }
  | {
      kind: "failed";
      reason:
        | "not_configured"
        | "unsupported_format"
        | "too_large"
        | "http_error"
        | "invalid_response"
        | "timeout"
        | "network";
      detail: string;
    };

/**
 * Formatos que WhatsApp acepta, por familia.
 *
 * ⚠️ HALLAZGO — `audio/webm` NO ESTÁ, Y NO ES UN OLVIDO.
 *
 * WhatsApp no reproduce WebM. El grabador de Nexus negocia
 * `audio/mp4 → audio/webm;codecs=opus → audio/webm → audio/ogg;codecs=opus`,
 * de modo que en Safari/iOS produce mp4 —que sirve— pero en Chrome/Android
 * produce **webm**, que Meta rechaza. Un mensaje de voz grabado desde Android
 * no puede enviarse a WhatsApp tal cual: hay que negociar un formato compatible
 * ANTES de grabar, no intentar convertirlo después.
 *
 * Por eso la lista se aplica acá y no se delega a Meta: un rechazo local dice
 * exactamente qué pasó, mientras que el error remoto llega opaco y después de
 * haber subido el binario entero.
 */
export const WHATSAPP_MEDIA_MIME: Readonly<Record<MetaMediaKind, readonly string[]>> = {
  image: ["image/jpeg", "image/png"],
  document: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  // `audio/ogg` sólo con códec OPUS, que es lo que produce el grabador.
  audio: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"],
} as const;

/** Topes de Meta por familia, en bytes. */
export const WHATSAPP_MEDIA_MAX_BYTES: Readonly<Record<MetaMediaKind, number>> = {
  image: 5 * 1024 * 1024,
  document: 100 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
} as const;

/** Familia de WhatsApp para un MIME ya verificado por firma. `null` = no enviable. */
export function whatsappKindForMime(mime: string): MetaMediaKind | null {
  const limpio = mime.split(";")[0].trim().toLowerCase();
  for (const kind of ["image", "document", "audio"] as const) {
    if (WHATSAPP_MEDIA_MIME[kind].includes(limpio)) return kind;
  }
  return null;
}

/**
 * ¿Se puede mandar esto por WhatsApp? Mensaje CONCRETO cuando no.
 *
 * El mensaje nombra el formato: «no se puede enviar» a secas deja al operador
 * probando de nuevo con el mismo archivo.
 */
export function checkWhatsappMedia(
  mime: string,
  bytes: number,
): { ok: true; kind: MetaMediaKind } | { ok: false; reason: "unsupported_format" | "too_large"; detail: string } {
  const kind = whatsappKindForMime(mime);
  if (!kind) {
    const limpio = mime.split(";")[0].trim().toLowerCase();
    if (limpio === "image/webp" || limpio === "image/gif" || limpio === "image/heic" || limpio === "image/heif") {
      return {
        ok: false,
        reason: "unsupported_format",
        detail: `WhatsApp no acepta ${limpio}: convertí la imagen a JPEG o PNG.`,
      };
    }
    if (limpio === "audio/webm") {
      return {
        ok: false,
        reason: "unsupported_format",
        detail: "WhatsApp no reproduce WebM: grabá el mensaje de voz en un formato compatible.",
      };
    }
    return { ok: false, reason: "unsupported_format", detail: `WhatsApp no acepta ${limpio}.` };
  }
  if (bytes > WHATSAPP_MEDIA_MAX_BYTES[kind]) {
    const mb = Math.round(WHATSAPP_MEDIA_MAX_BYTES[kind] / (1024 * 1024));
    return { ok: false, reason: "too_large", detail: `WhatsApp acepta hasta ${mb} MB para este tipo.` };
  }
  return { ok: true, kind };
}

export interface MetaMediaTransport {
  uploadMedia(input: {
    bytes: Uint8Array;
    mimeType: string;
    fileName: string;
  }): Promise<MetaUploadOutcome>;
  sendMedia(input: {
    to: string;
    kind: MetaMediaKind;
    mediaId: string;
    caption?: string;
    fileName?: string;
  }): Promise<MetaSendOutcome>;
}

export interface MetaMediaTransportConfig {
  token: string | undefined;
  phoneNumberId: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  graphBase?: string;
}

/** `media_id` del cuerpo de `/media`. `null` ⇒ contrato roto. */
export function extractMediaId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

export function createMetaMediaTransport(config: MetaMediaTransportConfig): MetaMediaTransport {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = config.graphBase ?? GRAPH;

  const credenciales = (): { token: string; phoneNumberId: string } | null => {
    const token = config.token?.trim();
    const phoneNumberId = config.phoneNumberId?.trim();
    return token && phoneNumberId ? { token, phoneNumberId } : null;
  };

  return {
    async uploadMedia({ bytes, mimeType, fileName }): Promise<MetaUploadOutcome> {
      const cred = credenciales();
      if (!cred) {
        return {
          kind: "failed",
          reason: "not_configured",
          detail: "META_WA_TOKEN / META_WA_PHONE_NUMBER_ID ausentes",
        };
      }
      // El formato se decide ACÁ, antes de gastar la subida del binario.
      const admisible = checkWhatsappMedia(mimeType, bytes.length);
      if (!admisible.ok) {
        return { kind: "failed", reason: admisible.reason, detail: admisible.detail };
      }

      const forma = new FormData();
      forma.append("messaging_product", "whatsapp");
      forma.append("type", mimeType);
      forma.append("file", new Blob([bytes as unknown as BlobPart], { type: mimeType }), fileName);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${base}/${cred.phoneNumberId}/media`, {
          method: "POST",
          // Sin `Content-Type` a mano: lo pone `fetch` con el boundary correcto.
          headers: { Authorization: `Bearer ${cred.token}` },
          body: forma,
          signal: controller.signal,
        });
      } catch (e) {
        const abortado = e instanceof Error && e.name === "AbortError";
        // Una subida incierta NO deja mensajes en vuelo: como mucho un
        // `media_id` colgado, que caduca solo. Es seguro reintentar.
        return {
          kind: "failed",
          reason: abortado ? "timeout" : "network",
          detail: abortado ? `timeout ${timeoutMs}ms` : "fallo de red",
        };
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        // El mensaje del proveedor NO se propaga: sólo el código.
        return { kind: "failed", reason: "http_error", detail: `HTTP ${res.status}` };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await res.text());
      } catch {
        return { kind: "failed", reason: "invalid_response", detail: "2xx no parseable" };
      }
      const mediaId = extractMediaId(parsed);
      if (!mediaId) {
        return { kind: "failed", reason: "invalid_response", detail: "2xx sin id de media" };
      }
      return { kind: "uploaded", mediaId };
    },

    async sendMedia({ to, kind, mediaId, caption, fileName }): Promise<MetaSendOutcome> {
      const cred = credenciales();
      if (!cred) {
        return {
          kind: "rejected",
          reason: "not_configured",
          status: null,
          detail: "META_WA_TOKEN / META_WA_PHONE_NUMBER_ID ausentes",
        };
      }

      // El audio de WhatsApp NO admite pie: mandarlo haría que Meta descartara
      // el campo en silencio y el operador creería haber escrito algo que el
      // cliente nunca vio.
      const adjunto: Record<string, unknown> = { id: mediaId };
      if (kind !== "audio" && caption && caption.trim().length > 0) {
        adjunto.caption = caption.trim().slice(0, 1024);
      }
      if (kind === "document" && fileName) adjunto.filename = fileName;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${base}/${cred.phoneNumberId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: to.replace(/\D/g, ""),
            type: kind,
            [kind]: adjunto,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        const abortado = e instanceof Error && e.name === "AbortError";
        return {
          kind: "ambiguous",
          reason: abortado ? "timeout" : "network",
          detail: abortado ? `timeout ${timeoutMs}ms` : "fallo de red",
        };
      } finally {
        clearTimeout(timer);
      }

      // A partir de acá el contrato es EXACTAMENTE el de `sendText`: un envío
      // incierto pudo llegarle al cliente y jamás se reintenta solo.
      let parsed: unknown;
      try {
        const cuerpo = await res.text();
        if (res.ok && cuerpo.trim().length === 0) {
          return { kind: "ambiguous", reason: "invalid_2xx", detail: "2xx con cuerpo vacío" };
        }
        parsed = JSON.parse(cuerpo);
      } catch {
        if (res.ok) return { kind: "ambiguous", reason: "invalid_2xx", detail: "2xx no parseable" };
        if (isAmbiguousStatus(res.status)) {
          return { kind: "ambiguous", reason: "server_error", detail: `HTTP ${res.status}` };
        }
        return {
          kind: "rejected", reason: "invalid_json", status: res.status,
          detail: "respuesta no parseable",
        };
      }

      if (!res.ok) {
        if (isAmbiguousStatus(res.status)) {
          return { kind: "ambiguous", reason: "server_error", detail: `HTTP ${res.status}` };
        }
        return { kind: "rejected", reason: "http_error", status: res.status, detail: `HTTP ${res.status}` };
      }

      const wamid = extractWamid(parsed);
      if (!wamid) {
        return { kind: "ambiguous", reason: "contract_unknown", detail: "2xx sin messages[0].id" };
      }
      return { kind: "accepted", wamid };
    },
  };
}
