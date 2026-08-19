/**
 * link-projection.ts — LINK-WA S1 · Proyección del inbound WhatsApp a Nexus Link.
 *
 * Convierte los mensajes normalizados por `inbound.ts` en conversaciones y
 * mensajes de Nexus Link REUTILIZANDO el modelo existente (0143): no hay tabla
 * nueva, columna nueva ni migración. Convenciones tomadas del importador
 * histórico (`connect/wa-import/ingest.ts`) para que el hilo vivo y el
 * importado de la misma contraparte sean EL MISMO hilo:
 *
 *   · context_id            = `wa:<E164>`   (unique index connect_conversations_context_uidx)
 *   · conversación kind     = 'whatsapp'
 *   · participante externo  = participant_type 'whatsapp', member_role 'guest'
 *   · mensaje kind          = 'whatsapp', body_format 'text'
 *   · idempotencia          = external_msg_id := wamid (connect_messages_external_uidx)
 *
 * service_role (requisitos de Dirección): sólo server-side, sólo después de
 * firma Meta válida y con el mapeo cuenta/número→tenant ya resuelto por
 * `parseInboundPayload`; escrituras estrechas e idempotentes. NO sustituye la
 * autorización outbound del operador (eso vive en la capa de respuesta, con
 * sesión y RBAC del usuario).
 *
 * Membresía: deny-by-default. Sólo los perfiles expresamente configurados en
 * WHATSAPP_SANDBOX_OPERATOR_PROFILE_IDS y validados contra `profiles` se
 * incorporan. Sin operadores configurados el hilo se crea igual pero queda sin
 * lector: la RLS de connect_messages exige membresía y no tiene bypass de admin.
 *
 * La lógica es agnóstica al driver: habla contra `LinkProjectionPort`, lo que
 * permite testearla con fixtures sintéticas en memoria, sin red ni Supabase.
 */

import type { WaInboundMessage, WaInboundStatus, WaStatusValue } from "./inbound";
import type { InboundMedia } from "./inbound-media";

export interface ProjectionConversation {
  id: string;
  archivedAt: string | null;
}

export interface ProjectionParticipant {
  id: string;
  profileId: string | null;
  phone: string | null;
}

export interface ProjectionMessageRow {
  conversationId: string;
  authorParticipantId: string | null;
  externalMsgId: string;
  body: string;
  createdAt: string;
}

/** Puerto estrecho: cada método es una escritura o lectura acotada e idempotente. */
export interface LinkProjectionPort {
  findConversationByContext(contextId: string): Promise<ProjectionConversation | null>;
  createConversation(input: {
    contextId: string;
    title: string;
    topic: string;
  }): Promise<ProjectionConversation>;
  unarchiveConversation(conversationId: string): Promise<void>;
  listParticipants(conversationId: string): Promise<ProjectionParticipant[]>;
  addStaffParticipant(conversationId: string, profileId: string): Promise<void>;
  addWhatsappParticipant(input: {
    conversationId: string;
    phone: string;
    displayName: string;
  }): Promise<string>;
  /**
   * Inserta UN mensaje. R1A: se abandonó el insert masivo — un 23505 del lote
   * marcaba como duplicado a todos sus hermanos y se perdían mensajes nuevos.
   * Ahora cada fila se resuelve sola contra el índice único de external_msg_id.
   */
  insertMessage(row: ProjectionMessageRow): Promise<"inserted" | "duplicate">;
  /**
   * H-7 · guarda el media ENTRANTE y lo liga a su mensaje.
   *
   * Devuelve `stored` si quedó guardado, `duplicate` si ese mismo objeto ya
   * estaba —el reproceso de un evento no debe duplicar adjuntos—,
   * `unsupported` si el formato no se sabe guardar, y lanza SÓLO ante un fallo
   * reintentable, para que el evento quede reprocesable.
   *
   * C4/HIGH-1 · `unsupported` es terminal a propósito. Cuando era una excepción,
   * el evento nunca llegaba a `processed` y se reprocesaba para siempre,
   * re-descargando el binario de la Graph API en cada vuelta.
   *
   * Opcional en el puerto: las suites que sólo ejercen texto y status no
   * tienen por qué implementarlo. Si no está, el media NO se pierde en
   * silencio: se registra como error y el evento no se marca procesado.
   */
  ingestInboundMedia?(input: {
    conversationId: string;
    externalMsgId: string;
    media: InboundMedia;
  }): Promise<"stored" | "duplicate" | "unsupported">;
  /** Perfiles de `ids` que existen, están activos y pertenecen al tenant. */
  resolveEligibleOperators(ids: string[]): Promise<string[]>;
  /**
   * CAS del estado del saliente identificado por wamid.
   *  · `applied`   — transición válida efectivamente escrita.
   *  · `noop`      — evento repetido, anterior o prohibido (failed sobre read…).
   *  · `unmatched` — no existe fila con ese wamid: el status llegó ANTES del
   *                  sello. Queda pendiente de reconciliación.
   */
  applyOutboundStatus(status: WaInboundStatus): Promise<"applied" | "noop" | "unmatched">;
}

export interface ProjectionResult {
  conversationsTouched: number;
  conversationsCreated: number;
  messagesInserted: number;
  messagesDuplicated: number;
  operatorsAdded: number;
  statusesApplied: number;
  /** Repetidos, anteriores o prohibidos: transición correctamente ignorada. */
  statusesNoop: number;
  /** Status llegado ANTES del sello del wamid: pendiente de reconciliación. */
  statusesUnmatched: number;
  /** H-7 · adjuntos entrantes efectivamente guardados. */
  mediaStored: number;
  /**
   * C4/HIGH-1 · adjuntos cuyo formato este ingreso no sabe guardar.
   *
   * NO son errores: el evento se completa igual. Pero se CUENTAN, porque un
   * cero silencioso fue lo que hizo invisible la pérdida original.
   */
  mediaUnsupported: number;
  errors: string[];
}

/**
 * ¿La proyección se completó sin residuos? Sólo con `true` el evento puede
 * marcarse `processed`: un error parcial o un status pendiente de reconciliar
 * deben dejar el evento reprocesable.
 */
export function isProjectionComplete(r: ProjectionResult): boolean {
  return r.errors.length === 0 && r.statusesUnmatched === 0;
}

const TOPIC = "WhatsApp Comercial";

/**
 * Código del status que no encontró su mensaje saliente.
 *
 * Es un CÓDIGO, no un mensaje: viaja hasta `wa_inbound_events.last_error`, una
 * columna consultable, y el evento del que proviene contiene el teléfono y el
 * texto de un tercero. Nunca lleva el wamid ni la contraparte.
 *
 * Por qué existe: `statusesUnmatched` era el ÚNICO desenlace que dejaba la
 * proyección incompleta sin escribir una razón. El consumidor recibía
 * `errors: []`, saneaba `undefined` y lo archivaba como «error_desconocido».
 * Seis días de eventos terminales quedaron sin diagnóstico posible por eso.
 */
export const STATUS_UNMATCHED_REASON = "status_unmatched";

/**
 * La decisión de transición vive en `outbound-state.ts` (máquina única para
 * inbound y outbound). El rank local anterior era incorrecto: daba a `failed`
 * el rango más alto, con lo que un error tardío de Meta pisaba un `delivered`
 * o `read` ya confirmado.
 */
export { canTransition as shouldAdvanceStatus } from "./outbound-state";

export function contextIdFor(phoneE164: string): string {
  return `wa:${phoneE164}`;
}

function emptyResult(): ProjectionResult {
  return {
    conversationsTouched: 0,
    conversationsCreated: 0,
    messagesInserted: 0,
    messagesDuplicated: 0,
    operatorsAdded: 0,
    statusesApplied: 0,
    statusesNoop: 0,
    statusesUnmatched: 0,
    mediaStored: 0,
    mediaUnsupported: 0,
    errors: [],
  };
}

/**
 * Proyecta mensajes y estados. Idempotente por construcción: reprocesar el
 * mismo evento no duplica conversación, participante ni mensaje.
 */
export async function projectInbound(
  input: { messages: WaInboundMessage[]; statuses: WaInboundStatus[] },
  port: LinkProjectionPort,
  operatorProfileIds: string[],
): Promise<ProjectionResult> {
  const result = emptyResult();

  // Operadores: se resuelven UNA vez por lote y sólo si hay algo que proyectar.
  let eligibleOperators: string[] | null = null;
  const ensureOperators = async (): Promise<string[]> => {
    if (eligibleOperators) return eligibleOperators;
    eligibleOperators = operatorProfileIds.length
      ? await port.resolveEligibleOperators(operatorProfileIds)
      : [];
    return eligibleOperators;
  };

  // Agrupar por contraparte: un hilo por teléfono.
  const byPhone = new Map<string, WaInboundMessage[]>();
  for (const m of input.messages) {
    const bucket = byPhone.get(m.fromE164);
    if (bucket) bucket.push(m);
    else byPhone.set(m.fromE164, [m]);
  }

  for (const [phone, msgs] of byPhone) {
    try {
      const contextId = contextIdFor(phone);
      const displayName = msgs.find((m) => m.profileName)?.profileName ?? phone;

      let conv = await port.findConversationByContext(contextId);
      if (!conv) {
        conv = await port.createConversation({ contextId, title: displayName, topic: TOPIC });
        result.conversationsCreated += 1;
      }
      result.conversationsTouched += 1;

      const participants = await port.listParticipants(conv.id);

      // Operadores autorizados que todavía no son miembros.
      const operators = await ensureOperators();
      const memberProfileIds = new Set(
        participants.map((p) => p.profileId).filter((id): id is string => Boolean(id)),
      );
      for (const profileId of operators) {
        if (memberProfileIds.has(profileId)) continue;
        await port.addStaffParticipant(conv.id, profileId);
        memberProfileIds.add(profileId);
        result.operatorsAdded += 1;
      }

      // Participante externo (la contraparte), uno por teléfono.
      let externalId = participants.find((p) => p.phone === phone)?.id ?? null;
      if (!externalId) {
        externalId = await port.addWhatsappParticipant({
          conversationId: conv.id,
          phone,
          displayName,
        });
      }

      // R1A · fila por fila. El índice único de external_msg_id arbitra cada
      // mensaje por separado: un duplicado no arrastra a sus hermanos nuevos, y
      // dos lotes solapados [A,B] y [B,C] terminan con A, B y C una sola vez.
      let insertedHere = 0;
      for (const m of msgs) {
        try {
          const outcome = await port.insertMessage({
            conversationId: conv.id,
            authorParticipantId: externalId,
            externalMsgId: m.wamid,
            body: m.text,
            createdAt: m.sentAt,
          });
          if (outcome === "inserted") insertedHere += 1;
          else result.messagesDuplicated += 1;

          // H-7 · el adjunto se guarda DESPUÉS del mensaje y también cuando el
          // mensaje resultó duplicado: si un intento anterior insertó la fila y
          // murió antes de bajar el binario, éste lo termina. `ingestInboundMedia`
          // es idempotente por (bucket, path) y por el sha del contenido.
          if (m.media) {
            if (!port.ingestInboundMedia) {
              // Un puerto sin ingreso de media NO puede tragarse el archivo en
              // silencio: se declara error y el evento queda reprocesable.
              result.errors.push(`media ${m.wamid}: el puerto no ingresa adjuntos`);
            } else {
              const guardado = await port.ingestInboundMedia({
                conversationId: conv.id,
                externalMsgId: m.wamid,
                media: m.media,
              });
              if (guardado === "stored") result.mediaStored += 1;
              // `unsupported` no ensucia `errors`: el evento se completa y el
              // adjunto queda contado como no guardado, que es la verdad.
              else if (guardado === "unsupported") result.mediaUnsupported += 1;
            }
          }
        } catch (e) {
          // Falla de UN mensaje: se registra y se sigue con el resto. El evento
          // quedará incompleto y por lo tanto NO se marcará processed.
          result.errors.push(
            `mensaje ${m.wamid}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      result.messagesInserted += insertedHere;

      // Un mensaje nuevo reactiva un hilo archivado por el importador
      // histórico (D1 rige el nacimiento del hilo, no su permanencia).
      if (insertedHere > 0 && conv.archivedAt) {
        await port.unarchiveConversation(conv.id);
      }
    } catch (e) {
      result.errors.push(
        `proyección ${phone}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  for (const st of input.statuses) {
    try {
      const outcome = await port.applyOutboundStatus(st);
      if (outcome === "applied") result.statusesApplied += 1;
      else if (outcome === "noop") result.statusesNoop += 1;
      else {
        result.statusesUnmatched += 1;
        // El motivo se escribe ACÁ, en el único punto que lo conoce, y le
        // devuelve al operador la diferencia entre «no sé qué pasó» y «este
        // acuse no tiene dueño».
        //
        // C4 · M-1 · EFECTO SOBRE EL DESENLACE, declarado y no afirmado de más:
        //  · si el acuse sin dueño es el ÚNICO motivo, nada cambia: el código no
        //    figura en PERMANENTES, así que `isPermanent` sigue dando false y el
        //    evento sigue siendo reintentable, igual que antes del arreglo;
        //  · en un LOTE MIXTO —un error permanente de mensaje MÁS un acuse sin
        //    dueño en el mismo `value`— el evento pasa de permanent a retryable,
        //    porque `isPermanent` exige que TODOS los motivos sean permanentes.
        //    Es deliberado y es la dirección segura: reintentar de más antes que
        //    descartar un hecho del proveedor, que es la política declarada del
        //    consumidor. Queda fijado por prueba en inbound-consumer.test.ts.
        result.errors.push(STATUS_UNMATCHED_REASON);
      }
    } catch (e) {
      result.errors.push(
        `estado ${st.status}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return result;
}
