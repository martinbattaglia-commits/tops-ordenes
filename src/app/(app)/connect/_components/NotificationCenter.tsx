"use client";

// Centro de Notificaciones (RC1.4) — UI. Modelo HÍBRIDO de refresco (D-RC1.4-5):
// realtime (tabla notifications) + polling fallback (30s). Lectura/orden vienen del server.
// Agrupa por prioridad en 3 secciones. Acciones SOLO para source==='notification'
// (las source==='conversation' son derivadas de inbox, no tienen estado propio).

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import { relTime } from "@/lib/utils";
import type { NotificationItem, NotificationPriority } from "@/lib/notifications/types";
import { SNOOZE_PRESETS } from "@/lib/notifications/snooze";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
  snoozeNotificationAction,
  delegateNotificationAction,
  setNotificationPriorityAction,
} from "@/lib/notifications/actions";
import { MemberSearch } from "./MemberSearch";

const SECTIONS: { priority: NotificationPriority; label: string; dot: string }[] = [
  { priority: "urgente", label: "Urgente", dot: "bg-tops-red" },
  { priority: "importante", label: "Importante", dot: "bg-amber-400" },
  { priority: "normal", label: "Normal", dot: "bg-fg-muted" },
];

export function NotificationCenter({ items }: { items: NotificationItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Modelo HÍBRIDO: realtime (tabla notifications) + polling fallback cada 30s.
  useRealtimeTable("notifications", () => router.refresh());
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [router]);

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setErr(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) setErr(r.message);
      else router.refresh();
    });
  }

  const hasUnread = items.some((i) => !i.read);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-stroke-soft bg-bg-surface px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon name="bell" size={18} className="text-fg-link" />
          <h1 className="text-sm font-bold text-fg-primary">Centro de Notificaciones</h1>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={pending || !hasUnread}
          onClick={() => run(() => markAllNotificationsReadAction())}
        >
          <Icon name="check" size={14} /> Marcar todas leídas
        </button>
      </header>

      {err && <p className="px-5 pt-3 text-xs text-tops-red">{err}</p>}

      {items.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Sin notificaciones"
          hint="Cuando haya novedades o mensajes nuevos, aparecerán acá."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mx-auto w-full max-w-3xl space-y-6">
            {SECTIONS.map(({ priority, label, dot }) => {
              const group = items.filter((i) => i.priority === priority);
              if (group.length === 0) return null;
              return (
                <section key={priority}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                    <h2 className="text-xs font-bold uppercase tracking-wide text-fg-secondary">
                      {label}
                    </h2>
                    <span className="text-[11px] text-fg-muted">{group.length}</span>
                  </div>
                  <div className="space-y-2">
                    {group.map((item) => (
                      <NotificationRow
                        key={item.id}
                        item={item}
                        dot={dot}
                        pending={pending}
                        onAction={run}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const PRIORITY_OPTIONS: { value: "low" | "normal" | "high" | "urgent"; label: string }[] = [
  { value: "low", label: "Baja" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Importante" },
  { value: "urgent", label: "Urgente" },
];

function NotificationRow({
  item,
  dot,
  pending,
  onAction,
}: {
  item: NotificationItem;
  dot: string;
  pending: boolean;
  onAction: (action: () => Promise<{ ok: true } | { ok: false; message: string }>) => void;
}) {
  const canAct = item.source === "notification";
  const [showSnooze, setShowSnooze] = useState(false);
  const [showDelegate, setShowDelegate] = useState(false);
  return (
    <div
      className={`card flex flex-col gap-2 p-3 ${item.read ? "" : "bg-tops-blue-700/5"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <Link href={item.href} className="flex min-w-0 flex-1 items-start gap-2.5">
          {!item.read && <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />}
          <div className="min-w-0">
            <p
              className={`truncate text-sm text-fg-primary ${
                item.read ? "font-medium" : "font-bold"
              }`}
            >
              {item.title}
            </p>
            {item.message && (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-secondary">{item.message}</p>
            )}
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-muted">
              <Icon name="clock" size={11} /> {relTime(item.createdAt)}
              {item.delegatedToMe && (
                <span className="chip bg-tops-red/10 text-[10px] text-tops-red">Delegada a mí</span>
              )}
              {item.isDelegated && !item.delegatedToMe && (
                <span className="chip text-[10px]">Delegada</span>
              )}
            </p>
          </div>
        </Link>

        {canAct && (
          <div className="flex shrink-0 items-center gap-1">
            {!item.read && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={pending}
                title="Marcar leída"
                onClick={() => onAction(() => markNotificationReadAction({ id: item.id }))}
              >
                <Icon name="check" size={13} />
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={pending}
              title="Posponer…"
              aria-expanded={showSnooze}
              onClick={() => { setShowSnooze((v) => !v); setShowDelegate(false); }}
            >
              <Icon name="clock" size={13} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={pending}
              title="Delegar a otro usuario"
              aria-expanded={showDelegate}
              onClick={() => { setShowDelegate((v) => !v); setShowSnooze(false); }}
            >
              <Icon name="users" size={13} />
            </button>
            <select
              aria-label="Cambiar prioridad"
              className="rounded border border-stroke-soft bg-bg-page px-1 py-0.5 text-[11px] text-fg-secondary"
              disabled={pending}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value as "low" | "normal" | "high" | "urgent" | "";
                e.target.value = "";
                if (!v) return;
                onAction(() => setNotificationPriorityAction({ id: item.id, priority: v }));
              }}
            >
              <option value="" disabled>
                Prioridad
              </option>
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {canAct && showSnooze && (
        <div className="flex items-center gap-1.5 border-t border-stroke-soft pt-2">
          <span className="text-[11px] text-fg-muted">Posponer:</span>
          {SNOOZE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={pending}
              onClick={() => {
                setShowSnooze(false);
                onAction(() =>
                  snoozeNotificationAction({
                    id: item.id,
                    until: p.until(new Date()).toISOString(),
                  })
                );
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {canAct && showDelegate && (
        <div className="border-t border-stroke-soft pt-2">
          <MemberSearch
            disabled={pending}
            onAdd={async (profileId) => {
              const r = await delegateNotificationAction({ id: item.id, toProfileId: profileId });
              if (r.ok) setShowDelegate(false);
              else onAction(async () => r);
              return r.ok;
            }}
          />
        </div>
      )}
    </div>
  );
}
