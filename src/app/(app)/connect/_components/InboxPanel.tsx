"use client";

// Nexus Link · UX-004: la bandeja pasa al margen DERECHO como contexto operativo.
// Desktop/tablet: columna lateral colapsable a riel (estado en localStorage; en
// tablet arranca colapsada si no hay preferencia). Mobile: botón flotante + drawer.
// El contenido es el mismo ConversationList probado — este wrapper sólo lo posiciona.

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { InboxItem } from "@/lib/connect/types";
import { ConversationList } from "./ConversationList";

const LS_KEY = "nexus-link:inbox-collapsed";

export function InboxPanel({ items }: { items: InboxItem[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored !== null) setCollapsed(stored === "1");
      // Sin preferencia guardada: en tablet (< lg) arranca colapsada — el hilo manda.
      else setCollapsed(!window.matchMedia("(min-width: 1024px)").matches);
    } catch {
      /* sin localStorage: queda expandida */
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_KEY, next ? "1" : "0");
      } catch {
        /* cosmético */
      }
      return next;
    });
  }

  const withUnread = items.reduce((n, i) => n + (i.unreadCount > 0 ? 1 : 0), 0);

  return (
    <>
      {/* Desktop / tablet: columna lateral derecha */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-l border-stroke-soft bg-bg-surface md:flex",
          collapsed ? "w-10" : "w-80",
        )}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={toggle}
            title="Abrir bandeja"
            className="flex flex-col items-center gap-1.5 py-3 transition-colors hover:bg-bg-surface-alt"
          >
            <Icon name="inbox" size={16} className="text-fg-secondary" />
            {withUnread > 0 && (
              <span className="rounded-full bg-tops-red px-1.5 text-[10px] font-bold text-white">
                {withUnread}
              </span>
            )}
          </button>
        ) : (
          <ConversationList items={items} onCollapse={toggle} />
        )}
      </aside>

      {/* Mobile: botón flotante + drawer a pantalla */}
      <div className="md:hidden">
        {!drawerOpen && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            title="Bandeja"
            className="fixed bottom-4 right-4 z-40 grid h-11 w-11 place-items-center rounded-full bg-tops-red text-white shadow-lg"
          >
            <Icon name="inbox" size={18} />
            {withUnread > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-black">
                {withUnread}
              </span>
            )}
          </button>
        )}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <button
              type="button"
              aria-label="Cerrar bandeja"
              className="absolute inset-0 bg-black/50"
              onClick={() => setDrawerOpen(false)}
            />
            <div className="relative flex h-full w-80 max-w-[85vw] flex-col border-l border-stroke-soft bg-bg-surface">
              <ConversationList
                items={items}
                onCollapse={() => setDrawerOpen(false)}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
