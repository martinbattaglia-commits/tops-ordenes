import type { ReactNode } from "react";
import { canReadInternalChat } from "@/lib/rbac/internal-chat";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { listInbox } from "@/lib/connect/read/inbox-data";
import { InboxPanel } from "./_components/InboxPanel";

export const dynamic = "force-dynamic";

/**
 * Nexus Link (Connect) — layout conversacional (UX-004): la conversación/workspace es el
 * espacio principal y la bandeja pasa al margen DERECHO como contexto operativo
 * (colapsable en desktop/tablet, drawer en mobile — InboxPanel). Gateado por connect.view
 * (fail-closed). RC1.1: la bandeja se alimenta de v_connect_inbox (o seeds en demo).
 */
export default async function ConnectLayout({ children }: { children: ReactNode }) {
  if (!(await canReadInternalChat())) {
    return <AccesoRestringido modulo="Nexus Link" />;
  }
  const inbox = await listInbox();

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col bg-bg-page">{children}</section>
      <InboxPanel items={inbox} />
    </div>
  );
}
