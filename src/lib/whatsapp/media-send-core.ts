/**
 * media-send-core.ts — NEXUS LINK · FASE B · decisión del envío de media por
 * WhatsApp. PURO: sin IO, sin Supabase, sin `fetch`, sin `Date` global.
 *
 * ─── POR QUÉ NO ES UN CAMINO NUEVO ────────────────────────────────────────
 *
 * Reutiliza la MISMA máquina de estados de outbound que el texto —`queued →
 * sending → sent`, con `failed` y `reconciliation_required` como salidas— y los
 * mismos puertos `claimSending` / `sealSent` / `stamp`, keyeados por el id del
 * mensaje que `finalizeAttachmentAction` ya creó. Inventarle un estado propio a
 * la media habría duplicado la parte más delicada del sistema por la razón más
 * pobre: que el payload es distinto.
 *
 * ─── EL CAS ES LO QUE IMPIDE EL DUPLICADO ─────────────────────────────────
 *
 * `claimSending` es una comparación-e-intercambio: sólo UNA llamada consigue
 * mover el mensaje a `sending`. Cualquier otra —un reintento del operador, un
 * doble clic, dos pestañas abiertas, un worker que corre dos veces— pierde y
 * devuelve `already_claimed` SIN tocar Meta. Es la diferencia entre reintentar
 * y duplicar: en WhatsApp un duplicado le llega al cliente y no se puede
 * retirar.
 *
 * ─── EL ORDEN IMPORTA ──────────────────────────────────────────────────────
 *
 * Se reclama ANTES de subir el binario. Al revés —subir y después reclamar—
 * dos llamadas concurrentes subirían dos veces el mismo archivo antes de que
 * una descubriera que perdió; con este orden, la perdedora se entera enseguida
 * y no gasta la subida.
 */

import type { MetaSendOutcome } from "./transport";
import {
  checkWhatsappMedia, type MetaMediaKind, type MetaMediaTransport,
} from "./media-transport";
import { necesitaRemuxParaWhatsapp, remuxWebmOpusAOgg } from "./opus-remux";

export type MediaSendResult =
  | { ok: true; state: "sent"; wamid: string }
  /** Otro intento ya tiene el mensaje: NO se reenvía. No es un error. */
  | { ok: true; state: "already_claimed" }
  | { ok: false; state: "failed"; message: string }
  /** Pudo haber llegado. Jamás se reintenta solo. */
  | { ok: false; state: "reconciliation_required"; message: string };

export interface MediaSendPorts {
  state: {
    /** CAS a `sending`. `true` sólo para el ganador. Un error debe lanzar. */
    claimSending(messageId: string): Promise<boolean>;
    /** Sello final con precondición de `sending` y wamid nulo. */
    sealSent(messageId: string, wamid: string): Promise<boolean>;
    stamp(
      messageId: string,
      patch: { status: "failed" | "reconciliation_required"; error?: string },
    ): Promise<boolean>;
  };
  /** Bytes del objeto ya validado por firma. `null` si no está. */
  objects: { read(bucket: string, path: string): Promise<Uint8Array | null> };
  transport: MetaMediaTransport;
  sandbox: { isAllowed(phoneE164: string): boolean };
}

export interface MediaSendInput {
  messageId: string;
  /** Teléfono de la contraparte, ya resuelto por el llamador. */
  to: string;
  bucket: string;
  path: string;
  /** MIME REAL, el que determinó la firma binaria; nunca el declarado. */
  mimeType: string;
  fileName: string;
  caption?: string;
}

/**
 * Prepara el binario para WhatsApp.
 *
 * El WebM se REENVASA a Ogg —mismo códec Opus, otro contenedor— porque WhatsApp
 * no reproduce WebM y es lo único que sabe grabar Chrome/Android. No se
 * convierte nada: los paquetes de audio salen bit a bit como entraron.
 */
export function prepararParaWhatsapp(
  bytes: Uint8Array,
  mimeType: string,
): { ok: true; bytes: Uint8Array; mimeType: string } | { ok: false; message: string } {
  if (!necesitaRemuxParaWhatsapp(mimeType)) return { ok: true, bytes, mimeType };
  const r = remuxWebmOpusAOgg(bytes);
  if (!r.ok) return { ok: false, message: r.message };
  return { ok: true, bytes: r.bytes, mimeType: "audio/ogg" };
}

/** Traduce el resultado del transporte al estado que corresponde persistir. */
function estadoDe(outcome: MetaSendOutcome): "sent" | "failed" | "reconciliation_required" {
  if (outcome.kind === "accepted") return "sent";
  if (outcome.kind === "rejected") return "failed";
  return "reconciliation_required";
}

export async function sendWhatsappMedia(
  input: MediaSendInput,
  ports: MediaSendPorts,
): Promise<MediaSendResult> {
  // El sandbox se evalúa ANTES del CAS: si el destino no está autorizado no hay
  // nada que reclamar, y dejar el mensaje en `sending` bloquearía un reintento
  // legítimo después de habilitar el número.
  if (!ports.sandbox.isAllowed(input.to)) {
    return {
      ok: false,
      state: "failed",
      message: "Sandbox WhatsApp activo: destino fuera de la allowlist.",
    };
  }

  // ─── EL CAS ───────────────────────────────────────────────────────────────
  const gane = await ports.state.claimSending(input.messageId);
  if (!gane) return { ok: true, state: "already_claimed" };

  const fallar = async (message: string): Promise<MediaSendResult> => {
    // `failed` deja el intento REINTENTABLE: nada salió hacia el cliente.
    await ports.state.stamp(input.messageId, { status: "failed", error: message });
    return { ok: false, state: "failed", message };
  };

  const crudo = await ports.objects.read(input.bucket, input.path);
  if (!crudo) return fallar("El archivo no está disponible.");

  const listo = prepararParaWhatsapp(crudo, input.mimeType);
  if (!listo.ok) return fallar(listo.message);

  const admisible = checkWhatsappMedia(listo.mimeType, listo.bytes.length);
  if (!admisible.ok) return fallar(admisible.detail);
  const kind: MetaMediaKind = admisible.kind;

  const subida = await ports.transport.uploadMedia({
    bytes: listo.bytes,
    mimeType: listo.mimeType,
    fileName: input.fileName,
  });
  // Una subida fallida —incluso por red— NO deja mensajes en vuelo: como mucho
  // un `media_id` colgado en Meta, que caduca solo. Es seguro reintentarla.
  if (subida.kind !== "uploaded") return fallar(`No se pudo subir el archivo (${subida.reason}).`);

  const envio = await ports.transport.sendMedia({
    to: input.to,
    kind,
    mediaId: subida.mediaId,
    caption: input.caption,
    fileName: input.fileName,
  });
  const estado = estadoDe(envio);

  if (estado === "sent" && envio.kind === "accepted") {
    const sellado = await ports.state.sealSent(input.messageId, envio.wamid);
    if (!sellado) {
      // Meta aceptó pero el sello no afectó ninguna fila: el mensaje SALIÓ y no
      // podemos afirmar que quedó registrado. Es reconciliación, no fallo — y
      // sobre todo no es reintentable.
      await ports.state.stamp(input.messageId, {
        status: "reconciliation_required",
        error: "aceptado por Meta sin sello local",
      });
      return {
        ok: false,
        state: "reconciliation_required",
        message: "El archivo salió pero no se pudo registrar. No lo reenvíes.",
      };
    }
    return { ok: true, state: "sent", wamid: envio.wamid };
  }

  if (estado === "reconciliation_required") {
    await ports.state.stamp(input.messageId, {
      status: "reconciliation_required",
      error: envio.kind === "ambiguous" ? envio.reason : "desconocido",
    });
    return {
      ok: false,
      state: "reconciliation_required",
      message: "No se pudo confirmar el envío. No lo reenvíes: puede haber llegado.",
    };
  }

  return fallar("WhatsApp rechazó el archivo.");
}
