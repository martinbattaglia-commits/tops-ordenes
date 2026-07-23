import Link from "next/link";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { listActivity } from "@/lib/connect/read/activity-data";
import { isConnectEntityType, contextualConversationHref } from "@/lib/connect/domain/entity-conversation";
import type { TimelineEntry } from "@/lib/knowledge/types";
import { relTime } from "@/lib/utils";
import { ActivityLive } from "../_components/ActivityLive";

export const metadata = { title: "Nexus Link · Centro de Actividad" };
export const dynamic = "force-dynamic";

/** Deep-link a la conversación contextual de la entidad, sólo si el tipo es válido. */
function entityHref(entry: TimelineEntry): string | null {
  if (!entry.entityType || !entry.entityId) return null;
  if (!isConnectEntityType(entry.entityType)) return null;
  return contextualConversationHref(entry.entityType, entry.entityId);
}

/** Centro de Actividad (D-RC1.4-6): feed cronológico vertical desde el timeline de Knowledge. */
export default async function ActivityPage() {
  const events = await listActivity(40);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <ActivityLive />
      <header className="border-b border-stroke-soft bg-bg-surface px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon name="activity" size={18} className="text-fg-link" />
          <h1 className="text-base font-bold text-fg-primary">Centro de Actividad</h1>
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">
          Lo que está pasando en la operación: eventos recientes en orden cronológico.
        </p>
      </header>

      {events.length === 0 ? (
        <EmptyState
          icon="activity"
          title="Sin actividad reciente"
          hint="Cuando ocurran eventos en la operación, aparecerán acá en tiempo real."
        />
      ) : (
        <div className="flex-1 px-5 py-5">
          <ol className="relative ml-2 border-l border-stroke-soft">
            {events.map((entry) => {
              const href = entityHref(entry);
              const title = entry.summary ?? entry.eventType;
              const body = (
                <div className="card px-4 py-3">
                  <p className="text-sm font-bold text-fg-primary">{title}</p>
                  <p className="mt-1 text-xs text-fg-secondary">
                    {entry.actorLabel ?? "Sistema"}
                    <span className="text-fg-muted"> · {relTime(entry.occurredAt)}</span>
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-fg-muted">{entry.eventType}</p>
                </div>
              );
              return (
                <li key={entry.id} className="relative mb-4 pl-6 last:mb-0">
                  <span
                    aria-hidden
                    className="absolute -left-[5px] top-3 h-2.5 w-2.5 rounded-full bg-tops-red ring-2 ring-bg-page"
                  />
                  {href ? (
                    <Link href={href} className="block transition-colors hover:bg-bg-surface-alt rounded-lg">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
