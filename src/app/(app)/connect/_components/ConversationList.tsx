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

const KIND_ICON: Record<ConversationKind, IconName> = {
  dm: "user", group: "users", channel: "megaphone", erp: "database",
  incident: "shield", whatsapp: "whatsapp", ai: "sparkle",
};

// UX-005: la paleta canónica vive en connect/theme.ts (KIND_COLOR importado).

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
  // INC-01/D-2: el error de archivado es POR HILO. Antes era un `string | null`
  // único que se pintaba como banner global de la vista, aunque la variable ya se
  // llamaba `rowError`: la intención estaba, el anclaje no.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  async function openArchive() {
    setTab("archivo");
    // INC-01/MEDIUM-3: los errores de archivado son de la bandeja ACTIVA. Sobrevivir al
    // cambio de pestaña los dejaba colgados de un hilo que quizá ya archivó otro.
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

  async function archiveItem(conversationId: string) {
    setBusyId(conversationId);
    // Sólo se limpia el error de ESTE hilo: el de los otros sigue visible.
    setRowErrors((prev) => {
      if (!(conversationId in prev)) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    const r = await archiveInboxItemAction({ conversationId });
    setBusyId(null);
    if (!r.ok) {
      setRowErrors((prev) => ({ ...prev, [conversationId]: r.message }));
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
              className="focus-nexus grid h-6 w-6 place-items-center rounded transition-colors hover:bg-bg-surface-alt"
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
          // INC-01/D-3: `canArchive` es el veredicto que el SERVIDOR calculó con las
          // mismas condiciones que evalúan las RPC. `undefined` (demo/seeds, o la
          // pestaña Archivo) = sin veredicto: se deja habilitado y manda el servidor.
          const archiveBlocked = it.canArchive === false;
          const archiveTip = archiveBlocked
            ? (it.archiveBlockedMessage ?? "No podés archivar este hilo.")
            : "Archivar el hilo";
          const rowMessage = rowErrors[it.conversationId];
          const tipId = `archive-tip-${it.conversationId}`;
          return (
            // INC-01/D-2: la FILA es este contenedor. El error vive acá, hermano del
            // enlace y no adentro: clickear el mensaje ya no navega al hilo.
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
                {/* UX-002c: código de color por tipo — nada queda en gris neutro. */}
                <Icon name={d.icon} size={15} className={d.color} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-fg-primary">
                  {d.title}
                </span>
                <div className="mt-0.5 flex items-center gap-2">
                  {!isArchive && (
                    // INC-01/D-3 · se muestra deshabilitado, pero con `aria-disabled` y no
                    // con `disabled`: un <button disabled> sale del orden de tabulación y
                    // no despacha eventos de mouse, así que su explicación no llegaría ni
                    // al mouse, ni al teclado, ni al lector de pantalla — y el gate
                    // preventivo terminaría siendo MENOS informativo que el mensaje que
                    // vino a evitar. Inaccionable por el guard del onClick, no por el DOM.
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
                          void archiveItem(it.conversationId);
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
                    // FASE A: el color identifica el canal —verde WhatsApp,
                    // amarillo chat interno— y la cifra es el conteo REAL de
                    // 0234, no la resta de secuencias globales.
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
            {/* INC-01/D-2: el error de ESTE hilo, dentro de ESTA fila. No es banner de
                la vista, no navega al clickearlo y no toca a los otros hilos. */}
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
    </>
  );
}
