import { Icon } from "@/components/Icon";
import { ENTITY_TYPE_LABELS, type ConnectEntityType } from "@/lib/connect/types";
import { isConnectEntityType } from "@/lib/connect/domain/entity-conversation";
import { getEntityConversation } from "@/lib/connect/read/entity-conversation-data";
import { listEntity360 } from "@/lib/connect/read/entity360-data";
import { listMessages } from "@/lib/connect/read/inbox-data";
import { getCurrentUserId } from "@/lib/connect/data";
import { ThreadView } from "../../../_components/ThreadView";
import { EntityContextPanel } from "../../../_components/EntityContextPanel";
import { StartEntityConversation } from "../../../_components/StartEntityConversation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Conversación contextual" };

export default async function EntityConversationPage({
  params,
}: {
  params: { entityType: string; entityId: string };
}) {
  const entityTypeRaw = decodeURIComponent(params.entityType);
  const entityId = decodeURIComponent(params.entityId);

  if (!isConnectEntityType(entityTypeRaw)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Icon name="x" size={22} className="text-fg-muted" />
        <p className="text-sm text-fg-muted">Tipo de entidad no soportado.</p>
      </div>
    );
  }
  const entityType = entityTypeRaw as ConnectEntityType;

  const [ref, events, currentUserId] = await Promise.all([
    getEntityConversation(entityType, entityId),
    listEntity360(entityType, entityId),
    getCurrentUserId(),
  ]);
  const messages = ref ? await listMessages(ref.conversationId) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="database" size={15} className="text-fg-link" />
            <h2 className="truncate text-sm font-bold text-fg-primary">
              Conversación contextual · {ENTITY_TYPE_LABELS[entityType]}
            </h2>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
            {ref?.contextId ?? "sin conversación"} · {entityType}:{entityId}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">
          {ref ? (
            <ThreadView conversationId={ref.conversationId} initialMessages={messages} currentUserId={currentUserId} />
          ) : (
            <StartEntityConversation entityType={entityType} entityId={entityId} />
          )}
        </div>
        <EntityContextPanel entityType={entityType} entityId={entityId} events={events} contextId={ref?.contextId} />
      </div>
    </div>
  );
}
