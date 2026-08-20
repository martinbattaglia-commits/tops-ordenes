"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { InboxItem, ConversationKind } from "@/lib/connect/types";
import { timeAgo } from "@/lib/connect/format";
import {
  listArchivedInboxAction, archiveInboxItemAction,
} from "@/lib/connect/adapters/driving/inbox-actions";
import { KIND_COLOR } from "@/lib/connect/theme";
import {
  CATEGORY_STYLE, categoryAriaLabel, categoryForConversationKind, formatBadgeCount,
} from "@/lib/notifications/categories";
import { EmptyState } from "@/components/ui/EmptyState";
import { calculateWa24hWindow } from "@/lib/whatsapp/window24h";

const KIND_ICON: Record<ConversationKind, IconName> = {
  dm: "user", group: "users", channel: "megaphone", erp: "database",
  incident: "shield", task: "check", whatsapp: "whatsapp", ai: "sparkle",
};

function displayParts(it: InboxItem): {
  title: string; num: string | null; icon: IconName; color: string;
} {
  const raw = it.title ?? (it.slug ? `#${it.slug}` : "Conversación");
  const m = raw.match(/^(TSK|INC)-\d{4}-(\d+)\s*—\s*(.+)$/);
  if (!m) return { title: raw, num: null, icon: KIND_ICON[it.kind], color: KIND_COLOR[it.kind] };
  return {
    title: m[3],
    num: m[2].padStart(4, "0").slice(-4),
    icon: m[1] === "TSK" ? "check-circle" : "bolt",
    color: "text-tops-red",
  };
}

type InboxTab = "activos" | "archivo";

export function ConversationList({
  items, onCollapse, onNavigate,
}: {
  items: InboxItem[];
  onCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<InboxTab>("activos");
  const [archived, setArchived] = useState<InboxItem[] | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Frente 2: Soft Modal state para confirmación de archivado con tarea/incidencia
  const [pendingArchiveItem, setPendingArchiveItem] = useState<{ id: string; title: string } | null>(null);

  async function openArchive() {
    setTab("archivo");
    setRowErrors({});
    if (archived !== null || loading) return;
    setLoading(true);
    setArchiveError(null);
    try {
      const res = await listArchivedInboxAction();
      if (res.ok) setArchived(res.items);
      else setArchiveError(res.message);
    } catch {
      setArchiveError("No se pudo cargar el archivo.");
    } finally {
      setLoading(false);
    }
  }

  async function archiveItem(conversationId: string, force = false, itemTitle = "Conversación") {
    setBusyId(conversationId);
    setRowErrors((prev) => {
      if (!(conversationId in prev)) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });

    const r = await archiveInboxItemAction(force ? { conversationId, force: true } : { conversationId });
    setBusyId(null);

    if (!r || !r.ok) {
      if (r && !force && r.reason === "entity_task_open") {
        // Frente 2: desatar soft modal de confirmación
        setPendingArchiveItem({ id: conversationId, title: itemTitle });
        return;
      }
      if (r?.message) {
        setRowErrors((prev) => ({ ...prev, [conversationId]: r.message }));
      }
      return;
    }

    setHiddenIds((prev) => new Set(prev).add(conversationId));
    setArchived(null);
    setPendingArchiveItem(null);
    router.refresh();
  }

  const isArchive = tab === "archivo";
  const base = isArchive
    ? (archived ?? [])
    : items.filter((it) => !hiddenIds.has(it.conversationId));
  const q = query.trim().toLowerCase();
  const visible = q
    ? base.filter((it) => {
        const d = displayParts(it);
        return (
          d.title.toLowerCase().includes(q) ||
          (d.num ?? "").includes(q) ||
          (it.topic ?? "").toLowerCase().includes(q)
        );
      })
    : base;

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-stroke-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name="chat" size={18} className="text-tops-red" />
          <h1 className="text-sm font-bold text-fg-primary">Nexus Link</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-fg-muted">{visible.length}</span>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Ocultar bandeja"
              className="focus-nexus grid h-6 w-6 place-items-center rounded transition-colors hover:bg-bg-surface-alt"
            >
              <Icon name="chevron-right" size={14} className="text-fg-muted" />
            </button>
          )}
        </div>
      </div>

      {/* Frente 1: Leyenda compacta de canales (Pills) arriba del buscador */}
      <div className="flex items-center gap-1.5 border-b border-stroke-soft bg-bg-surface-alt/40 px-3 py-1.5 text-[10px] font-medium overflow-x-auto">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> WhatsApp
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-500">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Chat interno
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-500">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Notificaciones
        </span>
      </div>

      {/* Buscador client-side */}
      <div className="border-b border-stroke-soft px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar conversación…"
          className="input w-full text-xs"
        />
      </div>

      <div className="flex border-b border-stroke-soft" role="tablist" aria-label="Bandeja">
        <button
          type="button"
          role="tab"
          aria-selected={!isArchive}
          onClick={() => { setTab("activos"); setRowErrors({}); }}
          className={cn(
            "focus-nexus flex-1 border-b-2 px-3 py-2 text-[11px] font-semibold transition-colors",
            !isArchive
              ? "border-tops-red text-fg-primary"
              : "border-transparent text-fg-muted hover:text-fg-secondary",
          )}
        >
          Activos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isArchive}
          onClick={openArchive}
          className={cn(
            "focus-nexus flex-1 border-b-2 px-3 py-2 text-[11px] font-semibold transition-colors",
            isArchive
              ? "border-tops-red text-fg-primary"
              : "border-transparent text-fg-muted hover:text-fg-secondary",
          )}
        >
          Archivo
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto">
        {isArchive && loading && (
          <p className="px-4 py-6 text-center text-xs text-fg-muted">Cargando archivo…</p>
        )}
        {isArchive && archiveError && !loading && (
          <p className="px-4 py-6 text-center text-xs text-fg-muted">{archiveError}</p>
        )}
        {!loading && !archiveError && visible.length === 0 && (
          <EmptyState
            size="sm"
            icon={isArchive ? "folder" : "chat"}
            title={
              q
                ? "Sin resultados"
                : isArchive
                  ? "Sin conversaciones archivadas"
                  : "Sin conversaciones todavía"
            }
            hint={q ? "Probá con otro nombre o número." : undefined}
          />
        )}
        {(!isArchive || (!loading && !archiveError)) && visible.map((it) => {
          const href = `/connect/c/${it.conversationId}`;
          const active = pathname === href;
          const d = displayParts(it);
          const archiveBlocked = it.canArchive === false;
          const archiveTip = archiveBlocked
            ? (it.archiveBlockedMessage ?? "No podés archivar este hilo.")
            : "Archivar el hilo";
          const rowMessage = rowErrors[it.conversationId];
          const tipId = `archive-tip-${it.conversationId}`;

          // Frente 3: Semáforo 24h para conversaciones de WhatsApp en la lista
          const waWindow = it.kind === "whatsapp" ? calculateWa24hWindow(it.lastMessageAt) : null;

          return (
            <div
              key={it.conversationId}
              data-conversation-id={it.conversationId}
              className={cn(
                "border-b border-stroke-soft",
                active ? "bg-bg-surface-alt" : "hover:bg-bg-surface-alt",
              )}
            >
              <Link
                href={href}
                onClick={onNavigate}
                className="flex items-start gap-2.5 py-2.5 pl-3 pr-1.5 transition-colors"
              >
                <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-surface-alt">
                  <Icon name={d.icon} size={15} className={d.color} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-fg-primary">
                    {d.title}
                  </span>
                  <div className="mt-0.5 flex items-center gap-2">
                    {!isArchive && (
                      <>
                        <button
                          type="button"
                          title={archiveTip}
                          aria-disabled={archiveBlocked || undefined}
                          aria-describedby={archiveBlocked ? tipId : undefined}
                          disabled={!archiveBlocked && busyId === it.conversationId}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (archiveBlocked || busyId === it.conversationId) return;
                            void archiveItem(it.conversationId, false, d.title);
                          }}
                          className={cn(
                            "focus-nexus shrink-0 rounded text-[11px] font-semibold transition-colors disabled:opacity-50",
                            archiveBlocked
                              ? "cursor-not-allowed text-fg-muted opacity-60"
                              : "text-amber-400 hover:text-amber-300",
                          )}
                        >
                          {busyId === it.conversationId ? "Archivando…" : "Archivar"}
                        </button>
                        {archiveBlocked && (
                          <span id={tipId} className="sr-only">{archiveTip}</span>
                        )}
                      </>
                    )}
                    {it.topic && (
                      <span className="truncate text-[11px] text-fg-muted">{it.topic}</span>
                    )}
                  </div>
                </div>

                <div className="mt-0.5 flex shrink-0 flex-col items-end gap-0.5 text-right">
                  {d.num && (
                    <span className="font-mono text-[10px] text-fg-muted">— {d.num}</span>
                  )}
                  <span className="text-[10px] text-fg-muted">{timeAgo(it.lastMessageAt)}</span>

                  {/* Frente 3: Badge de ventana 24h para WhatsApp */}
                  {waWindow && (
                    waWindow.isExpired ? (
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-500">
                        🔒 Ventana cerrada
                      </span>
                    ) : waWindow.isWarning ? (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-500">
                        {waWindow.formattedRemaining}
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">
                        {waWindow.formattedRemaining}
                      </span>
                    )
                  )}

                  {isArchive ? (
                    <span className="rounded-full bg-bg-surface-alt px-1.5 text-[10px] text-fg-muted">
                      Archivado
                    </span>
                  ) : (
                    it.unreadCount > 0 && (
                      <span
                        aria-label={categoryAriaLabel(categoryForConversationKind(it.kind), it.unreadCount)}
                        title={categoryAriaLabel(categoryForConversationKind(it.kind), it.unreadCount)}
                        className={`px-1.5 text-[10px] font-bold ${CATEGORY_STYLE[categoryForConversationKind(it.kind)].badgeClass}`}
                      >
                        {formatBadgeCount(it.unreadCount)}
                      </span>
                    )
                  )}
                </div>
              </Link>

              {rowMessage && (
                <p
                  role="alert"
                  data-testid="archive-error"
                  className="px-3 pb-2 pl-[3.25rem] text-[11px] leading-snug text-tops-red"
                >
                  {rowMessage}
                </p>
              )}
            </div>
          );
        })}
      </nav>

      {/* Frente 2: Soft Modal de Confirmación para Archivado con Tarea */}
      {pendingArchiveItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-stroke-soft bg-bg-surface p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-fg-primary">¿Archivar conversación?</h3>
            <p className="mt-2 text-xs text-fg-secondary leading-relaxed">
              Esta conversación tiene una tarea abierta (&quot;{pendingArchiveItem.title}&quot;). ¿Deseás archivarla de todos modos?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm text-xs"
                onClick={() => setPendingArchiveItem(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-nexus btn-sm text-xs bg-tops-red text-white"
                onClick={() => void archiveItem(pendingArchiveItem.id, true, pendingArchiveItem.title)}
              >
                Archivar de todos modos
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
