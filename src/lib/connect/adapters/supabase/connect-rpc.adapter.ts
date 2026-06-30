// Nexus Link · driven adapter (Supabase). Implementa ConnectWritePort invocando las RPC SECDEF de
// RC1.0 (0144) POR SESIÓN (createClient): el RPC re-valida has_permission('connect.*') + membresía,
// y audita al usuario real (no a postgres). RPC-first (G10): el front NUNCA escribe tablas directo.

import { ok, err, domainError, type Result } from "../../domain/result";
import type {
  ConnectWritePort, CreateConversationInput, PostMessageInput,
} from "../../ports/write-port";
import type { ConnectEntityType, MemberRole } from "../../types";

/** Cliente Supabase con .rpc (estructural; el SupabaseClient lo cumple). */
export interface RpcCapableClient {
  rpc(
    fn: string,
    params?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

/** Traduce un error Postgres conocido a mensaje humano (contrato §6.1). */
function mapPgError(message: string): string {
  if (/no es miembro|No es miembro/.test(message)) return "No sos miembro de esta conversación.";
  if (/insufficient_privilege|permiso/i.test(message)) return "No tenés permiso para esta acción.";
  if (/check_violation/i.test(message)) return "Datos inválidos para el vínculo.";
  return message;
}

export class ConnectRpcAdapter implements ConnectWritePort {
  constructor(private readonly client: RpcCapableClient) {}

  async createConversation(input: CreateConversationInput): Promise<Result<{ conversationId: string }>> {
    const { data, error } = await this.client.rpc("connect_create_conversation", {
      p_kind: input.kind,
      p_title: input.title ?? null,
      p_slug: input.slug ?? null,
      p_visibility: input.visibility ?? null,
      p_member_profile_ids: input.memberProfileIds ?? [],
      p_entity_type: input.entityType ?? null,
      p_entity_id: input.entityId ?? null,
      p_entity_id_text: input.entityIdText ?? null,
    });
    if (error) return err(domainError("rpc_error", mapPgError(error.message)));
    return ok({ conversationId: String(data) });
  }

  async postMessage(input: PostMessageInput): Promise<Result<{ messageId: string; seq: number }>> {
    const { data, error } = await this.client.rpc("connect_post_message", {
      p_conversation_id: input.conversationId,
      p_body: input.body,
      p_reply_to: input.replyTo ?? null,
      p_client_msg_id: input.clientMsgId,
      p_attachment_ids: input.attachmentIds ?? [],
    });
    if (error) return err(domainError("rpc_error", mapPgError(error.message)));
    // connect_post_message returns table(id, seq) → array de una fila.
    const row = Array.isArray(data) ? (data[0] as { id: string; seq: number } | undefined) : null;
    if (!row) return err(domainError("rpc_error", "El mensaje no devolvió id/seq."));
    return ok({ messageId: row.id, seq: Number(row.seq) });
  }

  async markRead(conversationId: string, upToSeq: number): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_mark_read", {
      p_conversation_id: conversationId,
      p_up_to_seq: upToSeq,
    });
    if (error) return err(domainError("rpc_error", mapPgError(error.message)));
    return ok(undefined);
  }

  async addMember(conversationId: string, profileId: string, role: MemberRole): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_add_member", {
      p_conversation_id: conversationId,
      p_profile_id: profileId,
      p_role: role,
    });
    if (error) return err(domainError("rpc_error", mapPgError(error.message)));
    return ok(undefined);
  }

  async linkEntity(
    conversationId: string, entityType: ConnectEntityType,
    entityId: string | null, entityIdText: string | null,
  ): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_link_entity", {
      p_conversation_id: conversationId,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_entity_id_text: entityIdText,
    });
    if (error) return err(domainError("rpc_error", mapPgError(error.message)));
    return ok(undefined);
  }
}
