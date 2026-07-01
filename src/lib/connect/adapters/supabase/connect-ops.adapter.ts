// Nexus Link · driven adapter (RC1.2). Implementa ChannelOpsPort vía RPC SECDEF por sesión.
// Reusa RpcCapableClient + el patrón de mapeo de error de RC1.1 (import, sin modificar RC1.1).

import { ok, err, domainError, type Result } from "../../domain/result";
import type { ChannelOpsPort } from "../../ports/channel-ops-port";
import type { MemberRole } from "../../types";
import type { RpcCapableClient } from "./connect-rpc.adapter";

function mapPgError(message: string): string {
  if (/canales públicos/i.test(message)) return "Solo te podés unir a canales públicos.";
  if (/no es miembro/i.test(message)) return "No sos miembro de esta conversación.";
  if (/insufficient_privilege|permiso|owner|moderator/i.test(message)) return "No tenés permiso para esta acción de moderación.";
  if (/inexistente|no_data_found/i.test(message)) return "El elemento ya no existe.";
  return message;
}

export class ConnectOpsAdapter implements ChannelOpsPort {
  constructor(private readonly client: RpcCapableClient) {}

  private async voidRpc(fn: string, params: Record<string, unknown>): Promise<Result<void>> {
    const { error } = await this.client.rpc(fn, params);
    if (error) return err(domainError("rpc_error", mapPgError(error.message)));
    return ok(undefined);
  }

  joinChannel(conversationId: string): Promise<Result<void>> {
    return this.voidRpc("connect_join_channel", { p_conversation_id: conversationId });
  }
  addMember(conversationId: string, profileId: string, role: MemberRole): Promise<Result<void>> {
    return this.voidRpc("connect_add_member", { p_conversation_id: conversationId, p_profile_id: profileId, p_role: role });
  }
  removeMember(conversationId: string, profileId: string): Promise<Result<void>> {
    return this.voidRpc("connect_remove_member", { p_conversation_id: conversationId, p_profile_id: profileId });
  }
  setMemberRole(conversationId: string, profileId: string, role: MemberRole): Promise<Result<void>> {
    return this.voidRpc("connect_set_member_role", { p_conversation_id: conversationId, p_profile_id: profileId, p_role: role });
  }
  archiveConversation(conversationId: string): Promise<Result<void>> {
    return this.voidRpc("connect_archive_conversation", { p_conversation_id: conversationId });
  }
  setTopic(conversationId: string, topic: string): Promise<Result<void>> {
    return this.voidRpc("connect_set_topic", { p_conversation_id: conversationId, p_topic: topic });
  }
  setTitle(conversationId: string, title: string): Promise<Result<void>> {
    return this.voidRpc("connect_set_title", { p_conversation_id: conversationId, p_title: title });
  }
  pinMessage(messageId: string): Promise<Result<void>> {
    return this.voidRpc("connect_pin_message", { p_message_id: messageId });
  }
  unpinMessage(messageId: string): Promise<Result<void>> {
    return this.voidRpc("connect_unpin_message", { p_message_id: messageId });
  }
}
