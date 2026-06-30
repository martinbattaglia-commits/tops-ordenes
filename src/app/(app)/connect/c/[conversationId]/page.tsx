import { Icon } from "@/components/Icon";
import { getConversation, listMessages } from "@/lib/connect/read/inbox-data";
import { listConversationLinks, getCurrentUserId } from "@/lib/connect/data";
import { ENTITY_TYPE_LABELS } from "@/lib/connect/types";
import { ThreadView } from "../../_components/ThreadView";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  dm: "Mensaje directo", group: "Grupo", channel: "Canal", erp: "Contexto ERP",
  incident: "Incidente", whatsapp: "WhatsApp", ai: "Asistente",
};

export default async function ConnectThreadPage({
  params,
}: {
  params: { conversationId: string };
}) {
  const [conversation, messages, links, currentUserId] = await Promise.all([
    getConversation(params.conversationId),
    listMessages(params.conversationId),
    listConversationLinks(params.conversationId),
    getCurrentUserId(),
  ]);

  if (!conversation) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Icon name="x" size={22} className="text-fg-muted" />
        <p className="text-sm text-fg-muted">La conversación no existe o no tenés acceso.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header del hilo */}
      <header className="flex items-center justify-between gap-3 border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-bold text-fg-primary">
              {conversation.title ?? KIND_LABEL[conversation.kind]}
            </h2>
            <span className="chip text-[10px]">{KIND_LABEL[conversation.kind]}</span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
            {conversation.contextId}
            {conversation.topic ? ` · ${conversation.topic}` : ""}
          </p>
        </div>
        {links.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {links.map((l) => (
              <span key={l.id} className="chip text-[10px]" title={l.entityId ?? l.entityIdText ?? ""}>
                <Icon name="database" size={11} className="text-fg-link" />
                {ENTITY_TYPE_LABELS[l.entityType]}
              </span>
            ))}
          </div>
        )}
      </header>

      <ThreadView
        conversationId={conversation.id}
        initialMessages={messages}
        currentUserId={currentUserId}
      />
    </div>
  );
}
