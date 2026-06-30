// Favoritos (RC1.4) — acceso rápido a conversaciones, canales y contextos ERP marcados con estrella.
// Server Component: lee la bandeja por sesión (RLS = frontera) y filtra is_favorite. El layout /connect
// ya gatea connect.view; acá NO se re-gatea. La interactividad (toggle estrella) vive en FavoriteStar (client).

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { FavoriteStar } from "@/components/connect/FavoriteStar";
import { listInbox } from "@/lib/connect/read/inbox-data";
import { relTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Favoritos" };

export default async function FavoritosPage() {
  const inbox = await listInbox();
  const favs = inbox.filter((i) => i.isFavorite);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-stroke-soft bg-bg-surface px-5 py-4">
        <Icon name="star" size={18} className="text-amber-400" />
        <h1 className="text-sm font-bold text-fg-primary">Favoritos</h1>
        <span className="ml-auto text-[11px] text-fg-muted">{favs.length}</span>
      </header>

      {favs.length === 0 ? (
        <EmptyState
          icon="star"
          title="Sin favoritos todavía"
          hint="Marcá conversaciones, canales o contextos ERP con la estrella para acceso rápido."
        />
      ) : (
        <nav className="flex-1 overflow-y-auto">
          {favs.map((it) => {
            const href = `/connect/c/${it.conversationId}`;
            const title = it.title ?? (it.slug ? `#${it.slug}` : "Conversación");
            return (
              <div
                key={it.conversationId}
                className="flex items-center gap-2 border-b border-stroke-soft/50 px-3 py-2.5 transition-colors hover:bg-bg-surface-alt"
              >
                <FavoriteStar conversationId={it.conversationId} initial={true} />
                <Link href={href} className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-fg-primary">{title}</span>
                  {it.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-tops-red px-1.5 text-[10px] font-bold text-white">
                      {it.unreadCount}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[10px] text-fg-muted">
                    {it.lastMessageAt ? relTime(it.lastMessageAt) : ""}
                  </span>
                </Link>
              </div>
            );
          })}
        </nav>
      )}
    </div>
  );
}
