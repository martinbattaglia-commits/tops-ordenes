"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { InboxItem, ConversationKind } from "@/lib/connect/types";
import { timeAgo } from "@/lib/connect/format";
import { listArchivedInboxAction } from "@/lib/connect/adapters/driving/inbox-actions";

const KIND_ICON: Record<ConversationKind, IconName> = {
  dm: "user", group: "users", channel: "megaphone", erp: "database",
  incident: "shield", whatsapp: "whatsapp", ai: "sparkle",
};

type InboxTab = "activos" | "archivo";

export function ConversationList({ items }: { items: InboxItem[] }) {
  const pathname = usePathname();
  // UX-002: Activos llega server-rendered del layout (sin cambios); Archivo se
  // fetchea UNA vez, recién al primer click — costo cero para el caso común.
  const [tab, setTab] = useState<InboxTab>("activos");
  const [archived, setArchived] = useState<InboxItem[] | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function openArchive() {
    setTab("archivo");
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

  const isArchive = tab === "archivo";
  const visible = isArchive ? (archived ?? []) : items;

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-stroke-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name="chat" size={18} className="text-tops-red" />
          <h1 className="text-sm font-bold text-fg-primary">Nexus Link</h1>
        </div>
        <span className="text-[11px] text-fg-muted">{visible.length}</span>
      </div>

      <div className="flex border-b border-stroke-soft" role="tablist" aria-label="Bandeja">
        <button
          type="button"
          role="tab"
          aria-selected={!isArchive}
          onClick={() => setTab("activos")}
          className={cn(
            "flex-1 border-b-2 px-3 py-2 text-[11px] font-semibold transition-colors",
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
            "flex-1 border-b-2 px-3 py-2 text-[11px] font-semibold transition-colors",
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
          <p className="px-4 py-6 text-center text-xs text-fg-muted">
            {isArchive ? "Sin conversaciones archivadas." : "Sin conversaciones todavía."}
          </p>
        )}
        {(!isArchive || (!loading && !archiveError)) && visible.map((it) => {
          const href = `/connect/c/${it.conversationId}`;
          const active = pathname === href;
          return (
            <Link
              key={it.conversationId}
              href={href}
              className={cn(
                "flex items-start gap-2.5 border-b border-stroke-soft/50 px-3 py-2.5 transition-colors",
                active ? "bg-bg-surface-alt" : "hover:bg-bg-surface-alt",
              )}
            >
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-surface-alt">
                <Icon name={KIND_ICON[it.kind]} size={15} className="text-fg-secondary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-fg-primary">
                    {it.title ?? (it.slug ? `#${it.slug}` : "Conversación")}
                  </span>
                  <span className="shrink-0 text-[10px] text-fg-muted">{timeAgo(it.lastMessageAt)}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-fg-muted">{it.topic ?? ""}</span>
                  {isArchive ? (
                    <span className="shrink-0 rounded-full bg-bg-surface-alt px-1.5 text-[10px] text-fg-muted">
                      Archivado
                    </span>
                  ) : (
                    it.unreadCount > 0 && (
                      <span className="shrink-0 rounded-full bg-tops-red px-1.5 text-[10px] font-bold text-white">
                        {it.unreadCount}
                      </span>
                    )
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
