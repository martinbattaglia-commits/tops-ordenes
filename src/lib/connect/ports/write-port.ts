// Nexus Link · ports (hexagonal). Interfaz de ESCRITURA del core de mensajería: la implementa el
// adapter Supabase (RPC SECDEF de RC1.0). Los use-cases dependen de esta interfaz, no de Supabase.

import type { Result } from "../domain/result";
import type { ConversationKind, ConnectEntityType, MemberRole } from "../types";

export interface CreateConversationInput {
  kind: ConversationKind;
  title?: string | null;
  slug?: string | null;
  visibility?: "public" | "private" | null;
  memberProfileIds?: string[];
  /** Vínculo opcional a entidad ERP al crear (D-RC1-5). */
  entityType?: ConnectEntityType | null;
  entityId?: string | null;
  entityIdText?: string | null;
}

export interface PostMessageInput {
  conversationId: string;
  body: string | null;
  replyTo?: string | null;
  /** Idempotencia de usuario (UUID del front). */
  clientMsgId: string;
  attachmentIds?: string[];
}

export interface ConnectWritePort {
  createConversation(input: CreateConversationInput): Promise<Result<{ conversationId: string }>>;
  postMessage(input: PostMessageInput): Promise<Result<{ messageId: string; seq: number }>>;
  markRead(conversationId: string, upToSeq: number): Promise<Result<void>>;
  addMember(conversationId: string, profileId: string, role: MemberRole): Promise<Result<void>>;
  linkEntity(
    conversationId: string,
    entityType: ConnectEntityType,
    entityId: string | null,
    entityIdText: string | null,
  ): Promise<Result<void>>;
}
