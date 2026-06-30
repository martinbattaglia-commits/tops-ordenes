// Nexus Link · application — casos de uso (RC1.1). Orquestan: validación de dominio + puerto de
// escritura. Sin Supabase directo (testeable con un fake del puerto). El borde (server action)
// traduce el Result a la union {ok}.

import { canPost, normalizeBody } from "../domain/message";
import { err, domainError, type Result } from "../domain/result";
import type {
  ConnectWritePort, CreateConversationInput, PostMessageInput,
} from "../ports/write-port";
import type { ConnectEntityType, MemberRole } from "../types";

export class CreateConversationUseCase {
  constructor(private readonly write: ConnectWritePort) {}
  async execute(input: CreateConversationInput): Promise<Result<{ conversationId: string }>> {
    if (input.kind === "channel" && !input.slug && !input.title) {
      return err(domainError("channel_needs_name", "Un canal requiere nombre o slug."));
    }
    if ((input.entityType && !input.entityId && !input.entityIdText)) {
      return err(domainError("link_needs_id", "El vínculo a entidad requiere un id."));
    }
    return this.write.createConversation(input);
  }
}

export class PostMessageUseCase {
  constructor(private readonly write: ConnectWritePort) {}
  async execute(input: PostMessageInput): Promise<Result<{ messageId: string; seq: number }>> {
    const attachments = input.attachmentIds?.length ?? 0;
    if (!canPost(input.body, attachments)) {
      return err(domainError("empty_message", "El mensaje no puede estar vacío."));
    }
    if (!input.clientMsgId) {
      return err(domainError("missing_client_msg_id", "Falta el identificador de idempotencia."));
    }
    return this.write.postMessage({ ...input, body: normalizeBody(input.body) });
  }
}

export class MarkReadUseCase {
  constructor(private readonly write: ConnectWritePort) {}
  async execute(conversationId: string, upToSeq: number): Promise<Result<void>> {
    if (upToSeq < 0) return err(domainError("bad_seq", "seq inválido."));
    return this.write.markRead(conversationId, upToSeq);
  }
}

export class LinkEntityUseCase {
  constructor(private readonly write: ConnectWritePort) {}
  async execute(
    conversationId: string, entityType: ConnectEntityType,
    entityId: string | null, entityIdText: string | null,
  ): Promise<Result<void>> {
    if (!entityId && !entityIdText) {
      return err(domainError("link_needs_id", "El vínculo requiere un id."));
    }
    return this.write.linkEntity(conversationId, entityType, entityId, entityIdText);
  }
}

export class AddMemberUseCase {
  constructor(private readonly write: ConnectWritePort) {}
  async execute(conversationId: string, profileId: string, role: MemberRole): Promise<Result<void>> {
    return this.write.addMember(conversationId, profileId, role);
  }
}
