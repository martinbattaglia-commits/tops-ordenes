/**
 * inbound-core.ts — LINK-WA 1B-1B · Orquestación testeable del webhook.
 *
 * Sin Supabase, sin `process.env`, sin `NextResponse`: recibe el body crudo y
 * devuelve `{status, body}`. La route real es un adaptador delgado.
 *
 * Invariantes preservados de R1A:
 *  · la firma se verifica sobre el body CRUDO, antes de parsear;
 *  · el evento se persiste ANTES de proyectar (custodia durable);
 *  · si la persistencia falla → respuesta retryable, nunca 2xx;
 *  · una proyección parcial o con estados pendientes NO marca processed=true;
 *  · las respuestas no exponen PII, texto, teléfonos ni secretos.
 */

import type { WaInboundParse, WaInboundMessage, WaInboundStatus } from "./inbound";
import { isProjectionComplete, type ProjectionResult } from "./link-projection";
// HIGH-3 · clasificación transitorio/permanente. Módulo PURO: no arrastra IO.
import { isTransient } from "./inbound-consumer";

export interface InboundRequest {
  rawBody: string;
  signatureHeader: string | null;
}

export interface InboundResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface InboundPorts {
  verifySignature(
    rawBody: string,
    header: string | null,
  ): { valid: boolean; reason: string };
  parsePayload(payload: unknown): WaInboundParse;
  store: {
    /** Devuelve el `seq` del evento persistido, o null si no hay custodia. */
    persist(payload: unknown): Promise<number | null>;
    markProcessed(seq: number, notes: string): Promise<void>;
    markPending(seq: number, notes: string): Promise<void>;
  };
  project(input: {
    messages: WaInboundMessage[];
    statuses: WaInboundStatus[];
  }): Promise<ProjectionResult>;
  /** Auditoría del rechazo de firma. Muestreada por el llamador. */
  auditSignatureRejection(reason: string): Promise<void>;
  shouldAuditRejection(): boolean;
  logger: { error(message: string): void; warn(message: string): void };
}

/**
 * R6 · Categoría estable a partir de un mensaje de error interno. Nunca
 * devuelve texto libre: los mensajes de proyección incluyen wamid y teléfono.
 */
export function errorCategory(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("mensaje ")) return "message_write";
  if (m.includes("proyección") || m.includes("conversación")) return "conversation_write";
  if (m.includes("participante") || m.includes("operador")) return "participant_write";
  if (m.includes("estado")) return "status_write";
  return "unknown";
}

export async function handleInboundEvent(
  req: InboundRequest,
  ports: InboundPorts,
): Promise<InboundResponse> {
  const sig = ports.verifySignature(req.rawBody, req.signatureHeader);
  if (!sig.valid) {
    if (sig.reason === "no_secret") {
      return { status: 503, body: { ok: false, error: "app_secret_not_configured" } };
    }
    if (ports.shouldAuditRejection()) {
      await ports.auditSignatureRejection(sig.reason);
    }
    return { status: 401, body: { ok: false, error: "invalid_signature" } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(req.rawBody);
  } catch {
    // No se descarta: se persiste como no parseable para no perder custodia.
    payload = { _unparseable: true, _length: req.rawBody.length };
  }

  // CUSTODIA DURABLE OBLIGATORIA antes de proyectar.
  let seq: number | null;
  try {
    seq = await ports.store.persist(payload);
  } catch (e) {
    ports.logger.error("category=custody_write");
    seq = null;
  }
  if (seq == null) {
    return { status: 503, body: { ok: false, error: "event_not_persisted", retryable: true } };
  }

  const projection = await projectSafely(payload, seq, ports);
  return { status: 200, body: { ok: true, received: true, persisted: true, projection } };
}

type ProjectionSummary =
  | { projected: false; reason: string; processed: boolean }
  | {
      projected: true;
      messages: number;
      duplicates: number;
      statuses: number;
      pending: number;
      processed: boolean;
    };

async function projectSafely(
  payload: unknown,
  seq: number,
  ports: InboundPorts,
): Promise<ProjectionSummary> {
  try {
    const parsed = ports.parsePayload(payload);
    if (!parsed.ok) {
      // ── HIGH-3 · un fallo de parseo NO es siempre culpa del evento ────────
      //
      // `tenant_unresolved` significa que falta `META_WA_PHONE_NUMBER_ID` en la
      // configuración del proceso. El payload puede ser impecable y el mismo
      // evento se proyectará bien apenas la variable esté puesta.
      //
      // Marcarlo `processed` —como hacía este camino para CUALQUIER motivo— lo
      // sacaba de la cola de forma definitiva: un error de despliegue borraba
      // hechos reales de Meta, y ni siquiera quedaba rastro para recuperarlos.
      //
      // Los motivos que describen el CONTENIDO del payload sí son terminales:
      // este tenant no va a poder proyectarlos nunca.
      if (isTransient(parsed.reason)) {
        await ports.store.markPending(seq, `pendiente por configuración: ${parsed.reason}`);
        return { projected: false, reason: parsed.reason, processed: false };
      }
      await ports.store.markProcessed(seq, `no proyectado: ${parsed.reason}`);
      return { projected: false, reason: parsed.reason, processed: true };
    }
    if (!parsed.messages.length && !parsed.statuses.length) {
      await ports.store.markProcessed(seq, "sin mensajes de texto ni estados");
      return { projected: false, reason: "nothing_to_project", processed: true };
    }

    const result = await ports.project({
      messages: parsed.messages,
      statuses: parsed.statuses,
    });
    // R6 · los errores de `link-projection` traen wamid y a veces el teléfono.
    // Nunca llegan crudos al logger: sólo categoría estable + correlación.
    for (const err of result.errors) {
      ports.logger.error(`event=${seq} category=${errorCategory(err)}`);
    }

    const complete = isProjectionComplete(result);
    const notes =
      `msgs=${result.messagesInserted} dup=${result.messagesDuplicated} ` +
      `status=${result.statusesApplied} noop=${result.statusesNoop} ` +
      `pending=${result.statusesUnmatched} ops=${result.operatorsAdded} err=${result.errors.length}`;
    // R7 · si la marca no acredita su fila, el evento NO puede reportarse como
    // procesado: se degrada a pendiente y, si eso también falla, se informa.
    if (complete) {
      try {
        await ports.store.markProcessed(seq, notes);
      } catch {
        ports.logger.error(`event=${seq} category=mark_failed`);
        return { projected: false, reason: "mark_failed", processed: false };
      }
    } else {
      try {
        await ports.store.markPending(seq, notes);
      } catch {
        ports.logger.error(`event=${seq} category=mark_failed`);
      }
    }

    return {
      projected: true,
      messages: result.messagesInserted,
      duplicates: result.messagesDuplicated,
      statuses: result.statusesApplied,
      pending: result.statusesUnmatched,
      processed: complete,
    };
  } catch (e) {
    ports.logger.error(`event=${seq} category=${errorCategory(e instanceof Error ? e.message : "")}`);
    await ports.store.markPending(seq, "projection_error").catch(() => {});
    return { projected: false, reason: "projection_error", processed: false };
  }
}
