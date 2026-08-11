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

export function createSupabaseProjectionPort(admin: AdminClient): LinkProjectionPort {
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
