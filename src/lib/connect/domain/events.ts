// Nexus Link · dominio — Domain Events (Parte II §2.2 del spec; mismo molde que prospeccion/domain/events).
// Inmutables, en pasado, versionados. CONTRATO DE NOMBRE: el `name` es el MISMO slug que el trigger
// SQL `_connect_enqueue_message` (0144) persiste en `connect_outbox.topic`. Sync 1:1 TS↔Outbox para
// evitar drift. RC1.1 materializa el paso de mensajería; el resto del fan-out lo drena el worker (RC1.4).

import type { ConnectEntityType } from "../types";

export interface DomainEvent<TName extends string, TPayload> {
  readonly eventId: string; // IdGeneratorPort
  readonly name: TName;
  readonly aggregateId: string; // conversationId
  readonly occurredAt: string; // ISO, ClockPort
  readonly version: 1;
  readonly payload: Readonly<TPayload>;
}

/** Topic canónico que escribe el trigger de outbox (0144): 'connect.message.posted'. */
export type ConnectMessagePosted = DomainEvent<
  "connect.message.posted",
  {
    messageId: string;
    seq: number;
    authorProfileId: string | null;
    kind: string;
  }
>;

/** Mención (fan-out a notificación connect_mention). Forward para RC1.4. */
export type ConnectMentionRaised = DomainEvent<
  "connect.mention",
  { messageId: string; mentionedProfileId: string }
>;

/** Vínculo conversación↔entidad ERP (forward al adapter Knowledge 0149, vía DB). */
export type ConnectConversationLinked = DomainEvent<
  "connect.conversation_linked",
  { entityType: ConnectEntityType; entityId: string; linkId: string }
>;

export type ConnectDomainEvent =
  | ConnectMessagePosted
  | ConnectMentionRaised
  | ConnectConversationLinked;
