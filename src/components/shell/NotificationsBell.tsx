"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import { hrefFor } from "@/lib/notifications/href";
import { relTime } from "@/lib/utils";

interface Notification {
  id: string;
  kind: string;
  title: string;
  message: string;
  entity: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  const load = async () => {
    const supabase = createClient();
    if (!supabase) return;
    // F4.1C: la campana respeta el snooze (mismo criterio que el Centro, D-F41-10):
    // una notificación pospuesta no se lista ni cuenta en el badge hasta su remind_at.
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .or(`remind_at.is.null,remind_at.lte.${nowIso}`)
      .order("created_at", { ascending: false })
      .limit(15);
    if (!error && data) {
      setItems(data as Notification[]);
      setUnread(data.filter((n: Notification) => !n.read_at).length);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useRealtimeTable("notifications", () => {
    load();
  });

  const markAllRead = async () => {
    const supabase = createClient();
    if (!supabase) return;
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (ids.length === 0) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    load();
  };

  return (
    <div className="relative">
      <button
        aria-label={`Notificaciones${unread > 0 ? ` (${unread} sin leer)` : ""}`}
        onClick={() => setOpen((o) => !o)}
        className="nx-icon-btn relative inline-flex items-center justify-center w-10 h-10 rounded-md"
      >
        <Icon name="bell" size={17} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 grid place-items-center rounded-pill bg-tops-red text-white text-[9px] font-bold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 mt-1.5 w-80 max-w-[calc(100vw-24px)] bg-bg-surface border border-stroke-soft rounded-lg shadow-lg z-50 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-stroke-soft bg-neutral-50">
              <div className="text-sm font-bold text-fg-brand">Notificaciones</div>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-fg-link font-semibold hover:underline"
                >
                  Marcar todas leídas
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 && (
                <div className="px-3 py-6 text-sm text-fg-muted text-center">
                  Sin notificaciones todavía.
                </div>
              )}
              {items.map((n) => (
                <NotificationRow key={n.id} n={n} onClose={() => setOpen(false)} />
              ))}
            </div>
            <Link
              href="/connect/notificaciones"
              onClick={() => setOpen(false)}
              className="block border-t border-stroke-soft bg-neutral-50 px-3 py-2 text-center text-[11px] font-semibold text-fg-link hover:underline"
            >
              Ver todo el centro de notificaciones
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function NotificationRow({ n, onClose }: { n: Notification; onClose: () => void }) {
  // F4.1B: ruteo unificado con el Centro (hrefFor) — una mención/DM navega al hilo,
  // no a "#" (hasta F3 solo orders tenía destino).
  const href = hrefFor(n.entity, n.entity_id);
  const isUnread = !n.read_at;
  return (
    <Link
      href={href}
      onClick={onClose}
      className={`flex gap-2 px-3 py-2.5 border-b border-stroke-soft last:border-b-0 hover:bg-neutral-50 ${
        isUnread ? "bg-tops-blue-700/5" : ""
      }`}
    >
      <div
        className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${
          isUnread ? "bg-tops-red" : "bg-transparent"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-fg-primary truncate">{n.title}</div>
        <div className="text-[11px] text-fg-secondary truncate">{n.message}</div>
        <div className="text-[10px] text-fg-muted mt-0.5">{relTime(n.created_at)}</div>
      </div>
    </Link>
  );
}
