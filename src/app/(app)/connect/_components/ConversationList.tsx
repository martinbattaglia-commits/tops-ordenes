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

const KIND_ICON: Record<ConversationKind, IconName> = {
  dm: "user", group: "users", channel: "megaphone", erp: "database",
  incident: "shield", whatsapp: "whatsapp", ai: "sparkle",
};

// UX-002c: código de color de la bandeja — rojo = trabajo operativo (tarea/avería);
// azul = comunicación (personas/grupos/canales/ERP); verde = WhatsApp; violeta = IA.
const KIND_COLOR: Record<ConversationKind, string> = {
  dm: "text-fg-link", group: "text-fg-link", channel: "text-fg-link", erp: "text-fg-link",
  incident: "text-tops-red", whatsapp: "text-emerald-500", ai: "text-violet-400",
};

/**
 * UX-002b (Dirección, smoke 07-26): los hilos de entidad guardan el título como
 * "TSK-2026-0017 — texto". En la bandeja va el nombre humano PRIMERO, el ícono
 * según tipo (tarea/avería) y el número reducido a 4 dígitos al extremo derecho.
 */
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
  /** UX-004: colapsa el panel derecho (o cierra el drawer en mobile). */
  onCollapse?: () => void;
  /** UX-004: en el drawer mobile, navegar cierra la bandeja. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // UX-004: buscador client-side sobre la pestaña visible (sin backend).
  const [query, setQuery] = useState("");
  // UX-002: Activos llega server-rendered del layout (sin cambios); Archivo se
  // fetchea UNA vez, recién al primer click — costo cero para el caso común.
  const [tab, setTab] = useState<InboxTab>("activos");
  const [archived, setArchived] = useState<InboxItem[] | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // UX-002c: archivado directo desde la fila — oculta al instante, el server confirma.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

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

  async function archiveItem(conversationId: string) {
    setBusyId(conversationId);
    setRowError(null);
    const r = await archiveInboxItemAction({ conversationId });
    setBusyId(null);
    if (!r.ok) {
      setRowError(r.message);
      return;
    }
    setHiddenIds((prev) => new Set(prev).add(conversationId));
    setArchived(null); // el Archivo se refetchea al próximo click, ya con este ítem
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
              className="grid h-6 w-6 place-items-center rounded transition-colors hover:bg-bg-surface-alt"
            >
              <Icon name="chevron-right" size={14} className="text-fg-muted" />
            </button>
          )}
        </div>
      </div>

      {/* UX-004: buscador client-side (filtra la pestaña visible, sin backend). */}
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
        {rowError && (
          <p className="border-b border-stroke-soft/50 px-4 py-2 text-[11px] text-tops-red">{rowError}</p>
        )}
        {(!isArchive || (!loading && !archiveError)) && visible.map((it) => {
          const href = `/connect/c/${it.conversationId}`;
          const active = pathname === href;
          const d = displayParts(it);
          return (
            <Link
              key={it.conversationId}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-start gap-2.5 border-b border-stroke-soft/50 py-2.5 pl-3 pr-1.5 transition-colors",
                active ? "bg-bg-surface-alt" : "hover:bg-bg-surface-alt",
              )}
            >
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-surface-alt">
                {/* UX-002c: código de color por tipo — nada queda en gris neutro. */}
                <Icon name={d.icon} size={15} className={d.color} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-fg-primary">
                  {d.title}
                </span>
                <div className="mt-0.5 flex items-center gap-2">
                  {!isArchive && (
                    <button
                      type="button"
                      disabled={busyId === it.conversationId}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void archiveItem(it.conversationId);
                      }}
                      className="shrink-0 text-[11px] font-semibold text-amber-400 transition-colors hover:text-amber-300 disabled:opacity-50"
                    >
                      {busyId === it.conversationId ? "Archivando…" : "Archivar"}
                    </button>
                  )}
                  {it.topic && (
                    <span className="truncate text-[11px] text-fg-muted">{it.topic}</span>
                  )}
                </div>
              </div>
              {/* UX-002c: columna nº/hora propia, pegada al borde derecho de la fila. */}
              <div className="mt-0.5 flex shrink-0 flex-col items-end gap-0.5 text-right">
                {d.num && (
                  <span className="font-mono text-[10px] text-fg-muted">— {d.num}</span>
                )}
                <span className="text-[10px] text-fg-muted">{timeAgo(it.lastMessageAt)}</span>
                {isArchive ? (
                  <span className="rounded-full bg-bg-surface-alt px-1.5 text-[10px] text-fg-muted">
                    Archivado
                  </span>
                ) : (
                  it.unreadCount > 0 && (
                    <span className="rounded-full bg-tops-red px-1.5 text-[10px] font-bold text-white">
                      {it.unreadCount}
                    </span>
                  )
                )}
              </div>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
