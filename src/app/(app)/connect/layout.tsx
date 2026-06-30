import type { ReactNode } from "react";
import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { listInbox } from "@/lib/connect/read/inbox-data";
import { ConversationList } from "./_components/ConversationList";

export const dynamic = "force-dynamic";

/**
 * Nexus Link (Connect) — layout de 2 columnas: bandeja (lista de conversaciones) + panel principal
 * (hilo o estado vacío). Gateado por connect.view (fail-closed: invisible/AccesoRestringido sin permiso).
 * RC1.1: la bandeja se alimenta de v_connect_inbox (o seeds en demo).
 */
export default async function ConnectLayout({ children }: { children: ReactNode }) {
  if (!(await canAccess("connect.view"))) {
    return <AccesoRestringido modulo="Nexus Link" />;
  }
  const inbox = await listInbox();

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 overflow-hidden">
      <aside className="flex w-80 shrink-0 flex-col border-r border-stroke-soft bg-bg-surface">
        <ConversationList items={inbox} />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col bg-bg-page">{children}</section>
    </div>
  );
}
