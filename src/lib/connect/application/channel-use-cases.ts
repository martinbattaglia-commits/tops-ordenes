// Nexus Link · application (RC1.2). Use-cases de canal/membresía/moderación/fijados.
// Orquestan validación de dominio + ChannelOpsPort. Testeables con un fake del port.

import { normalizeTopic } from "../domain/channel";
import { err, domainError, type Result } from "../domain/result";
import type { ChannelOpsPort } from "../ports/channel-ops-port";
import type { MemberRole } from "../types";

export class JoinChannelUseCase {
  constructor(private readonly ops: ChannelOpsPort) {}
  execute(conversationId: string): Promise<Result<void>> {
    return this.ops.joinChannel(conversationId);
  }
}

export class ManageMemberUseCase {
  constructor(private readonly ops: ChannelOpsPort) {}
  add(conversationId: string, profileId: string, role: MemberRole): Promise<Result<void>> {
    return this.ops.addMember(conversationId, profileId, role);
  }
  remove(conversationId: string, profileId: string): Promise<Result<void>> {
    return this.ops.removeMember(conversationId, profileId);
  }
  setRole(conversationId: string, profileId: string, role: MemberRole): Promise<Result<void>> {
    return this.ops.setMemberRole(conversationId, profileId, role);
  }
}

export class SetTopicUseCase {
  constructor(private readonly ops: ChannelOpsPort) {}
  async execute(conversationId: string, topic: string): Promise<Result<void>> {
    const t = normalizeTopic(topic);
    if (t.length === 0) return err(domainError("empty_topic", "El tema no puede estar vacío."));
    return this.ops.setTopic(conversationId, t);
  }
}

export class ArchiveConversationUseCase {
  constructor(private readonly ops: ChannelOpsPort) {}
  execute(conversationId: string): Promise<Result<void>> {
    return this.ops.archiveConversation(conversationId);
  }
}

export class PinMessageUseCase {
  constructor(private readonly ops: ChannelOpsPort) {}
  pin(messageId: string): Promise<Result<void>> {
    if (!messageId) return Promise.resolve(err(domainError("bad_message", "Mensaje inválido.")));
    return this.ops.pinMessage(messageId);
  }
  unpin(messageId: string): Promise<Result<void>> {
    return this.ops.unpinMessage(messageId);
  }
}

/** Helper de ensamblado para los server actions (evita repetir new ...UseCase). */
export function channelOps(ops: ChannelOpsPort) {
  return {
    join: new JoinChannelUseCase(ops),
    member: new ManageMemberUseCase(ops),
    topic: new SetTopicUseCase(ops),
    archive: new ArchiveConversationUseCase(ops),
    pin: new PinMessageUseCase(ops),
  };
}
