"use client";

// Nexus Link · UX-004: la bandeja pasa al margen DERECHO como contexto operativo.
// Desktop/tablet: columna lateral colapsable a riel (estado en localStorage; en
// tablet arranca colapsada si no hay preferencia). Mobile: botón flotante + drawer.
// El contenido es el mismo ConversationList probado — este wrapper sólo lo posiciona.

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { InboxItem } from "@/lib/connect/types";
import {
  CATEGORY_STYLE, categoryAriaLabel, categoryForConversationKind, formatBadgeCount,
} from "@/lib/notifications/categories";
import { ConversationList } from "./ConversationList";
import { CONNECT_READ_STATE_EVENT, type ConnectReadStateDetail } from "@/lib/connect/read-state-events";

const LS_KEY = "nexus-link:inbox-collapsed";

export function InboxPanel({ items }: { items: InboxItem[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [readSeqByConversation, setReadSeqByConversation] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const onRead = (event: Event) => {
      const detail = (event as CustomEvent<ConnectReadStateDetail>).detail;
      if (!detail?.conversationId || !Number.isFinite(detail.upToSeq)) return;
      setReadSeqByConversation((current) => {
        const next = new Map(current);
        next.set(
          detail.conversationId,
          Math.max(current.get(detail.conversationId) ?? 0, detail.upToSeq),
        );
        return next;
      });
    };
    window.addEventListener(CONNECT_READ_STATE_EVENT, onRead);
    return () => window.removeEventListener(CONNECT_READ_STATE_EVENT, onRead);
  }, []);

  const visibleItems = items.map((item) => {
    const localReadSeq = readSeqByConversation.get(item.conversationId);
    if (localReadSeq === undefined) return item;
    const effectiveReadSeq = Math.max(item.lastReadSeq, localReadSeq);
    const unreadCount = item.lastMessageSeq === null
      ? 0
      : Math.max(0, item.lastMessageSeq - effectiveReadSeq);
    return { ...item, lastReadSeq: effectiveReadSeq, unreadCount };
  });

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

  // C4 · M-6: el riel colapsado mostraba UN pill rojo que fusionaba WhatsApp y
  // chat interno. Ahora son dos cifras separadas, con su color, su icono y su
  // texto accesible, y cuentan MENSAJES pendientes (misma fuente que el resto),
  // no "conversaciones que tienen alguno".
  const pendientes = visibleItems.reduce(
    (acc, i) => {
      if (i.unreadCount <= 0) return acc;
      const cat = categoryForConversationKind(i.kind);
      return cat === "green_whatsapp"
        ? { ...acc, verde: acc.verde + i.unreadCount }
        : { ...acc, amarillo: acc.amarillo + i.unreadCount };
    },
    { verde: 0, amarillo: 0 },
  );

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
            {pendientes.verde > 0 && (
              <span
                aria-label={categoryAriaLabel("green_whatsapp", pendientes.verde)}
                title={categoryAriaLabel("green_whatsapp", pendientes.verde)}
                className={`px-1.5 text-[10px] font-bold ${CATEGORY_STYLE.green_whatsapp.badgeClass}`}
              >
                {formatBadgeCount(pendientes.verde)}
              </span>
            )}
            {pendientes.amarillo > 0 && (
              <span
                aria-label={categoryAriaLabel("yellow_internal", pendientes.amarillo)}
                title={categoryAriaLabel("yellow_internal", pendientes.amarillo)}
                className={`px-1.5 text-[10px] font-bold ${CATEGORY_STYLE.yellow_internal.badgeClass}`}
              >
                {formatBadgeCount(pendientes.amarillo)}
              </span>
            )}
          </button>
        ) : (
          <ConversationList items={visibleItems} onCollapse={toggle} />
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
            {/* Móvil: el botón flotante es uno solo, así que se apilan las dos
                cifras separadas en vez de sumarlas en un color ajeno a ambas. */}
            <span className="pointer-events-none absolute -right-1 -top-1 flex items-center gap-[2px]">
              {pendientes.verde > 0 && (
                <span
                  aria-label={categoryAriaLabel("green_whatsapp", pendientes.verde)}
                  title={categoryAriaLabel("green_whatsapp", pendientes.verde)}
                  className={`pointer-events-auto px-1 text-[10px] font-bold ${CATEGORY_STYLE.green_whatsapp.badgeClass}`}
                >
                  {formatBadgeCount(pendientes.verde)}
                </span>
              )}
              {pendientes.amarillo > 0 && (
                <span
                  aria-label={categoryAriaLabel("yellow_internal", pendientes.amarillo)}
                  title={categoryAriaLabel("yellow_internal", pendientes.amarillo)}
                  className={`pointer-events-auto px-1 text-[10px] font-bold ${CATEGORY_STYLE.yellow_internal.badgeClass}`}
                >
                  {formatBadgeCount(pendientes.amarillo)}
                </span>
              )}
            </span>
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
                items={visibleItems}
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
