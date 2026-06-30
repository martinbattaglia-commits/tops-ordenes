import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ENTITY_TYPE_LABELS, type ConnectEntityType } from "@/lib/connect/types";
import { erpEntityHref } from "@/lib/connect/domain/entity-conversation";
import type { Entity360Event } from "@/lib/connect/read/entity360-data";

/** Panel de contexto: cross-nav a la entidad ERP + timeline de Knowledge (v_knowledge_entity_360). */
export function EntityContextPanel({
  entityType, entityId, events, contextId,
}: {
  entityType: ConnectEntityType;
  entityId: string;
  events: Entity360Event[];
  contextId?: string | null;
}) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l border-stroke-soft bg-bg-surface lg:flex">
      <div className="border-b border-stroke-soft px-3 py-2.5">
        <div className="eyebrow-tiny">Contexto · Entity360</div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-xs font-bold text-fg-primary">{ENTITY_TYPE_LABELS[entityType]}</span>
          <Link href={erpEntityHref(entityType, entityId)} className="btn btn-ghost btn-sm shrink-0" title="Ir a la entidad en el ERP">
            <Icon name="arrow-up-right" size={12} /> Entidad
          </Link>
        </div>
        {contextId && <p className="mt-0.5 font-mono text-[10px] text-fg-muted">{contextId}</p>}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="eyebrow-tiny mb-2">Timeline (Knowledge)</div>
        {events.length === 0 ? (
          <p className="text-xs text-fg-muted">Sin eventos registrados para esta entidad.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-stroke-soft pl-3">
            {events.map((e) => (
              <li key={e.eventId} className="relative">
                <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-tops-red" />
                <div className="text-[12px] font-medium leading-snug text-fg-primary">{e.summary ?? e.eventType}</div>
                <div className="text-[10px] text-fg-muted">
                  {e.actorLabel ?? "—"} ·{" "}
                  {new Date(e.occurredAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="font-mono text-[9px] text-fg-muted">{e.eventType}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
