import "server-only";
import type { createAdminClient } from "@/lib/supabase/server";
import type {
  LinkProjectionPort,
  ProjectionConversation,
  ProjectionMessageRow,
  ProjectionParticipant,
} from "./link-projection";
import {
  canTransition,
  readAuditMarker,
  WA_AUDIT_MARKER_KEY,
  type WaOutboundState,
} from "./outbound-state";
import type { WaInboundStatus } from "./inbound";
import type { InboundMedia } from "./inbound-media";
import type { MetaMediaDownloadTransport } from "./media-transport";
import { normalizeFileName, validateAttachment } from "@/lib/connect/attachments/validate";
import { sniffAudio, AUDIO_LIMITS } from "@/lib/connect/audio/validate";
import { createHash, randomUUID } from "node:crypto";

/**
 * link-projection.supabase.ts — LINK-WA S1 · Adaptador service_role del puerto
 * de proyección.
 *
 * Único lugar del expediente donde se usa service_role, y sólo se instancia
 * desde el webhook DESPUÉS de la verificación HMAC y del mapeo
 * cuenta/número→tenant. Cada método es una escritura estrecha e idempotente:
 * no hay borrados, no hay updates masivos y no se toca ninguna fila fuera del
 * hilo WhatsApp correspondiente.
 *
 * NO crea roles, permisos, policies ni membresías fuera de los operadores
 * expresamente configurados y validados.
 */

/** Cliente mínimo requerido — evita depender de los tipos generados (reservados). */
type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

/** Reintentos del CAS de estado ante carrera. */
const CAS_ATTEMPTS = 3;

/**
 * WA-8R7 · procedencia de las escrituras de estado de este adaptador.
 *
 * Sólo la fija quien conoce el origen —acá, el proyector del webhook—; nunca
 * llega desde la UI ni desde un payload arbitrario.
 */
export const WA_STATUS_SOURCE_META = "meta" as const;

/** Mismo bucket que el saliente: no hay un almacén nuevo para lo entrante. */
const BUCKET = "connect-files";

type EntranteVerificado =
  | { ok: true; mime: string; fileName: string }
  | { ok: false };

/**
 * Verifica el binario entrante por FIRMA BINARIA, con el validador que
 * corresponde a su familia. Ver el docblock de `createInboundMediaIngest`.
 */
function verificarEntrante(
  bytes: Uint8Array,
  media: InboundMedia,
): EntranteVerificado {
  if (media.kind === "audio") {
    if (bytes.length === 0 || bytes.length > AUDIO_LIMITS.maxBytes) return { ok: false };
    const s = sniffAudio(bytes);
    if (!s) return { ok: false };
    // El nombre del entrante lo propone un TERCERO: se normaliza igual que el
    // de un adjunto propio —descarta componentes de ruta y extensiones
    // prohibidas— y su extensión pasa a ser la del contenido real.
    return { ok: true, mime: s.mime, fileName: normalizeFileName(media.fileName, s.ext) };
  }
  const v = validateAttachment(bytes, media.fileName);
  return v.ok ? { ok: true, mime: v.sniffed.mime, fileName: v.fileName } : { ok: false };
}

/**
 * H-7 · ingreso del media entrante.
 *
 * Recorre EXACTAMENTE los mismos pasos que el saliente y en el mismo orden:
 * bajar los bytes, verificar la FIRMA BINARIA real —nunca el MIME que declara
 * el proveedor—, subir a `connect-files` bajo la carpeta de la conversación
 * (que es lo que exige la policy de storage de 0237) y registrar la fila en
 * `connect_attachments` ligada a su mensaje.
 *
 * Idempotente por `(storage_bucket, storage_path)`: el path se deriva del
 * wamid, así que reprocesar el mismo evento reconoce el objeto que ya existe
 * en vez de duplicarlo.
 *
 * C4/LOW-1 · el SELECT previo NO es lo que cierra la carrera —entre consultar y
 * escribir hay una ventana, y la reentrega concurrente de Meta es la norma—.
 * El árbitro es el índice `connect_attachments_storage_bucket_storage_path_key`,
 * UNIQUE sobre `(storage_bucket, storage_path)`, MEDIDO en producción: ya
 * existía, así que el catch del 23505 de acá abajo tiene quién lo dispare y
 * esta corrección no necesitó migración. El SELECT queda como atajo que evita
 * bajar el binario de nuevo, no como garantía.
 *
 * ─── C4/HIGH-1 · POR QUÉ HAY DOS VALIDADORES ──────────────────────────────
 *
 * `validateAttachment` conoce imágenes y documentos; su sniffer no tiene NI UNA
 * firma de audio. Validar con él TODO lo entrante rechazaba las notas de voz de
 * WhatsApp —Ogg/Opus—, que son justo el caso que H-7 decía recuperar. El audio
 * se valida con `sniffAudio`, el MISMO módulo que ya usa el saliente.
 *
 * ─── Y POR QUÉ «NO SOPORTADO» NO ES UNA EXCEPCIÓN ─────────────────────────
 *
 * Un `throw` acá llegaba a `result.errors`, dejaba el evento incompleto y lo
 * hacía reprocesar indefinidamente, RE-DESCARGANDO el binario de la Graph API
 * en cada vuelta. Un formato que no sabemos guardar no es un fallo transitorio:
 * es un desenlace terminal y se devuelve como tal (`unsupported`), para que el
 * evento se marque procesado y quede registro de qué no se guardó. Sólo lo
 * genuinamente reintentable —la descarga, storage, la escritura— lanza.
 */
export function createInboundMediaIngest(
  admin: AdminClient,
  transport: MetaMediaDownloadTransport,
) {
  return async function ingestInboundMedia(input: {
    conversationId: string;
    externalMsgId: string;
    media: InboundMedia;
  }): Promise<"stored" | "duplicate" | "unsupported"> {
    // El path lo elige el SERVIDOR y se deriva del wamid: es la identidad que
    // Meta ya garantiza única, así que el reproceso cae sobre el mismo objeto.
    const huella = createHash("sha256").update(input.externalMsgId).digest("hex").slice(0, 32);
    const path = `${input.conversationId}/files/in-${huella}`;

    const { data: yaEsta } = await admin
      .from("connect_attachments")
      .select("id")
      .eq("storage_bucket", BUCKET)
      .eq("storage_path", path)
      .maybeSingle();
    if (yaEsta) return "duplicate";

    const bajado = await transport.downloadMedia(input.media.mediaId);
    if (bajado.kind !== "downloaded") {
      // El motivo viaja; el detalle del proveedor no, por la misma regla que
      // gobierna el saliente.
      throw new Error(`media ${input.externalMsgId}: descarga ${bajado.reason}`);
    }

    // El MIME que declara Meta NO se cree: manda la firma binaria, igual que en
    // `finalizeAttachmentAction`.
    const v = verificarEntrante(bajado.bytes, input.media);
    if (!v.ok) return "unsupported";

    const { error: subErr } = await admin.storage
      .from(BUCKET)
      .upload(path, bajado.bytes, { contentType: v.mime, upsert: false });
    if (subErr && !/exists|duplicate/i.test(subErr.message)) {
      throw new Error(`media ${input.externalMsgId}: storage ${subErr.message}`);
    }

    const { data: msg } = await admin
      .from("connect_messages")
      .select("id")
      .eq("conversation_id", input.conversationId)
      .eq("external_msg_id", input.externalMsgId)
      .maybeSingle();

    const { error: attErr } = await admin.from("connect_attachments").insert({
      conversation_id: input.conversationId,
      message_id: (msg as { id: string } | null)?.id ?? null,
      storage_bucket: BUCKET,
      storage_path: path,
      sha256: createHash("sha256").update(bajado.bytes).digest("hex"),
      mime_type: v.mime,
      file_size: bajado.bytes.length,
      file_name: v.fileName,
      // Entrante: no hay usuario interno que lo haya subido.
      uploaded_by: null,
    });
    if (attErr) {
      if (/duplicate|23505/i.test(attErr.message)) return "duplicate";
      throw new Error(`media ${input.externalMsgId}: adjunto ${attErr.message}`);
    }
    return "stored";
  };
}

export function createSupabaseProjectionPort(
  admin: AdminClient,
  /**
   * Transporte de descarga. Opcional para no romper a los llamadores que sólo
   * proyectan texto y status; sin él, un mensaje con media deja el evento
   * incompleto y reprocesable en vez de perder el archivo.
   */
  downloadTransport?: MetaMediaDownloadTransport,
): LinkProjectionPort {
  return {
    async findConversationByContext(contextId: string): Promise<ProjectionConversation | null> {
      const { data, error } = await admin
        .from("connect_conversations")
        .select("id, archived_at")
        .eq("context_id", contextId)
        .maybeSingle();
      if (error) throw new Error(`conversación (lookup): ${error.message}`);
      if (!data) return null;
      return { id: String(data.id), archivedAt: data.archived_at ?? null };
    },

    async createConversation(input): Promise<ProjectionConversation> {
      const { data, error } = await admin
        .from("connect_conversations")
        .insert({
          context_id: input.contextId,
          kind: "whatsapp",
          title: input.title,
          topic: input.topic,
          // Nace ACTIVA: a diferencia del importador histórico (D1, memoria),
          // un hilo vivo es accionable y debe aparecer en la bandeja.
          archived_at: null,
        })
        .select("id, archived_at")
        .single();
      if (error || !data) {
        // Carrera con otro POST de Meta: el unique index de context_id ganó.
        const existing = await this.findConversationByContext(input.contextId);
        if (existing) return existing;
        throw new Error(`conversación (insert): ${error?.message ?? "sin datos"}`);
      }
      return { id: String(data.id), archivedAt: data.archived_at ?? null };
    },

    async unarchiveConversation(conversationId: string): Promise<void> {
      const { error } = await admin
        .from("connect_conversations")
        .update({ archived_at: null })
        .eq("id", conversationId);
      if (error) throw new Error(`desarchivar: ${error.message}`);
    },

    async listParticipants(conversationId: string): Promise<ProjectionParticipant[]> {
      const { data, error } = await admin
        .from("connect_participants")
        .select("id, profile_id, external_ref")
        .eq("conversation_id", conversationId);
      if (error) throw new Error(`participantes: ${error.message}`);
      return ((data ?? []) as Array<Record<string, any>>).map((r) => ({
        id: String(r.id),
        profileId: r.profile_id ? String(r.profile_id) : null,
        phone: typeof r.external_ref?.phone === "string" ? r.external_ref.phone : null,
      }));
    },

    async addStaffParticipant(conversationId: string, profileId: string): Promise<void> {
      const { error } = await admin.from("connect_participants").insert({
        conversation_id: conversationId,
        participant_type: "staff",
        profile_id: profileId,
        member_role: "member",
      });
      // unique (conversation_id, profile_id) ⇒ una carrera es idempotencia, no error.
      if (error && !/duplicate|23505/i.test(error.message)) {
        throw new Error(`operador ${profileId}: ${error.message}`);
      }
    },

    async addWhatsappParticipant(input): Promise<string> {
      const { data, error } = await admin
        .from("connect_participants")
        .insert({
          conversation_id: input.conversationId,
          participant_type: "whatsapp",
          profile_id: null,
          member_role: "guest",
          external_ref: {
            phone: input.phone,
            side: "counterpart",
            display_name: input.displayName,
            source: "meta_cloud_api",
          },
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`participante wa: ${error?.message ?? "sin datos"}`);
      return String(data.id);
    },

    async insertMessage(row: ProjectionMessageRow): Promise<"inserted" | "duplicate"> {
      const { error } = await admin.from("connect_messages").insert({
        conversation_id: row.conversationId,
        author_participant_id: row.authorParticipantId,
        author_profile_id: null,
        kind: "whatsapp",
        body: row.body,
        body_format: "text",
        external_msg_id: row.externalMsgId,
        created_at: row.createdAt,
        meta: { wa: { direction: "inbound" } },
      });
      if (!error) return "inserted";
      // R1A · el 23505 se interpreta SOLO para esta fila. El índice parcial
      // `connect_messages_external_uidx` sigue siendo el árbitro; al insertar de
      // a una no hace falta que sea usable por ON CONFLICT.
      if (/duplicate|23505/i.test(error.message)) return "duplicate";
      throw new Error(`mensaje ${row.externalMsgId}: ${error.message}`);
    },

    ingestInboundMedia: downloadTransport
      ? createInboundMediaIngest(admin, downloadTransport)
      : undefined,

    async resolveEligibleOperators(ids: string[]): Promise<string[]> {
      if (!ids.length) return [];
      const { data, error } = await admin
        .from("profiles")
        .select("id, role, active")
        .in("id", ids);
      if (error) throw new Error(`operadores: ${error.message}`);
      // Validación de tenant/estado con lo YA existente: el perfil debe existir,
      // estar activo y tener rol asignado. La autorización de lectura efectiva
      // sigue siendo la RLS de Nexus Link; acá no se otorga permiso alguno.
      return ((data ?? []) as Array<Record<string, any>>)
        .filter((r) => r.active === true && r.role != null)
        .map((r) => String(r.id));
    },

    /**
     * CAS optimista sin RPC: el UPDATE lleva el estado esperado en el WHERE y se
     * verifica el row count. Si otro proceso cambió el estado entre la lectura y
     * la escritura, afecta 0 filas y se reevalúa. Así dos statuses concurrentes
     * no pueden provocar una regresión.
     */
    async applyOutboundStatus(status: WaInboundStatus): Promise<"applied" | "noop" | "unmatched"> {
      /**
       * WA-8R9 · §3.A · CERO read-modify-write desde el cliente.
       *
       * Antes esta función leía la fila, fusionaba `meta.wa` en JS y escribía el
       * objeto entero con un CAS por columnas JSON. Ese diseño tenía dos fallas
       * que ningún CAS por columnas cierra:
       *
       *  B-1. La fusión partía del snapshot leído. Si otro escritor agregaba
       *       `audit_sent` en el medio, el objeto reconstruido NO lo tenía y la
       *       escritura lo BORRABA — un hecho de auditoría perdido en silencio.
       *  H-1. Perder el CAS tres veces era indistinguible de "no había nada que
       *       hacer": ambos devolvían `noop`, el evento se marcaba `processed`
       *       y el status de Meta desaparecía.
       *
       * Ahora la decisión entera ocurre dentro de una transacción de PostgreSQL
       * que toma el lock de la fila: leer, decidir y escribir son atómicos.
       */
      const { data, error } = await admin.rpc("connect_wa_apply_status", {
        p_wamid: status.wamid,
        p_status: status.status,
        // La procedencia la fija ESTE adaptador, que sabe que el hecho viene de
        // un webhook de Meta. Nunca llega desde el payload.
        p_source: WA_STATUS_SOURCE_META,
        p_at: status.at,
        p_error_code: status.errorCode ?? null,
        // El detalle del proveedor. La RPC ya tenía el parámetro `p_error` y
        // nadie lo estaba usando: el texto que explicaba el fallo se perdía
        // entre el webhook y la fila. Sin migración.
        p_error: status.errorDetail ?? null,
      });
      if (error) throw new Error(`estado (rpc): ${error.message}`);

      switch (data) {
        // El hecho quedó escrito ahora.
        case "applied":
          return "applied";

        // Terminales sin escritura: el hecho ya estaba idéntico (replay
        // idempotente) o la fila no lo admite (entrante, canon, procedencia).
        // No acreditan `statusesApplied` — sólo se cuenta lo que se aplicó en
        // este lote — y no impiden marcar el evento como procesado.
        case "duplicate":
        case "rejected":
          return "noop";

        // No hay fila para ese wamid: el status llegó antes que el sello.
        case "unmatched":
          return "unmatched";

        // NO son "nada que hacer". El status NO quedó aplicado, así que el
        // evento debe permanecer reprocesable. Lanzar es el camino que el core
        // ya traduce en evento PENDIENTE (`processed` sigue en false), y es
        // exactamente lo que H-1 exigía dejar de colapsar en `noop`.
        case "retryable":
        case "reconciliation_required":
          throw new Error(`estado (${data}): requiere reproceso`);

        default:
          // Un resultado no previsto es fail-closed, nunca éxito.
          throw new Error(`estado: resultado desconocido (${String(data)})`);
      }
    },
  };
}
