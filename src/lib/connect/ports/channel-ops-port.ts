// Nexus Link · ports (RC1.2). Operaciones de canal/grupo: membresía, roles, moderación, fijados.
// Nuevo port (no toca el write-port de RC1.1). Lo implementa el adapter de Supabase vía RPC 0144/0150.

import type { Result } from "../domain/result";
import type { MemberRole } from "../types";

export interface ChannelOpsPort {
  /** Auto-unión a canal público (RPC connect_join_channel, 0150). */
  joinChannel(conversationId: string): Promise<Result<void>>;
  /** Alta de miembro por owner/moderator (RPC connect_add_member, 0144). */
  addMember(conversationId: string, profileId: string, role: MemberRole): Promise<Result<void>>;
  removeMember(conversationId: string, profileId: string): Promise<Result<void>>;
  setMemberRole(conversationId: string, profileId: string, role: MemberRole): Promise<Result<void>>;
  archiveConversation(conversationId: string): Promise<Result<void>>;
  setTopic(conversationId: string, topic: string): Promise<Result<void>>;
  /** Renombra el canal: cambia `title` (nombre visible), NUNCA `slug` ni `topic` (RPC connect_set_title, 0159). */
  setTitle(conversationId: string, title: string): Promise<Result<void>>;
  pinMessage(messageId: string): Promise<Result<void>>;
  unpinMessage(messageId: string): Promise<Result<void>>;
}
