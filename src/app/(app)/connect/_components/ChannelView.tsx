"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import type { ChannelItem, MemberRole } from "@/lib/connect/types";
import type { ChannelMember, PinnedItem } from "@/lib/connect/channel-mock";
import type { Message } from "@/lib/connect/types";
import { canModerate, canManageRoles } from "@/lib/connect/domain/channel";
import {
  joinChannelAction, setTitleAction, setTopicAction, archiveConversationAction,
  addMemberAction, removeMemberAction, setMemberRoleAction, unpinMessageAction,
} from "@/lib/connect/adapters/driving/channel-actions";
import { ThreadView } from "./ThreadView";
import { MemberSearch } from "./MemberSearch";

const ROLES: MemberRole[] = ["owner", "moderator", "member", "guest"];
const ROLE_LABEL: Record<MemberRole, string> = { owner: "Dueño", moderator: "Moderador", member: "Miembro", guest: "Invitado" };

export function ChannelView({
  channel, myRole, members = [], pinned = [], initialMessages = [], currentUserId,
}: {
  channel: ChannelItem;
  myRole: MemberRole | null;
  members?: ChannelMember[];
  pinned?: PinnedItem[];
  initialMessages?: Message[];
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showPinned, setShowPinned] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(channel.title ?? "");
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState(channel.topic ?? "");
  const [err, setErr] = useState<string | null>(null);

  // DEFECT-6: canal archivado → vista read-only; toda acción de moderación queda deshabilitada.
  const archived = !!channel.archivedAt;
  const moderator = canModerate(myRole);
  const canModerateActive = moderator && !archived;
  const canManageRolesActive = canManageRoles(myRole) && !archived;

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true); setErr(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setErr(r.message ?? "Acción fallida.");
    else router.refresh();
    return r.ok;
  }

  // DEFECT-6: al archivar, redirigir fuera del canal (al directorio) + refrescar (actualiza sidebar/listados).
  async function archive() {
    if (!confirm("¿Archivar este canal? Dejará de aparecer en el listado activo.")) return;
    setBusy(true); setErr(null);
    const r = await archiveConversationAction({ conversationId: channel.id });
    setBusy(false);
    if (!r.ok) { setErr(r.message ?? "No se pudo archivar."); return; }
    router.push("/connect/canales");
    router.refresh();
  }

  // ── Archivado + no-miembro: sin acción de unión (no se puede unir a un archivado) ────────
  if (archived && !myRole) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-bg-surface-alt">
          <Icon name="folder" size={24} className="text-fg-muted" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-fg-primary">{channel.title ?? `#${channel.slug}`}</h1>
          <p className="mt-1 text-sm text-fg-muted">Este canal está archivado.</p>
          <p className="mt-1 font-mono text-[11px] text-fg-muted">{channel.contextId}</p>
        </div>
      </div>
    );
  }

  // ── No-miembro (canal activo): vista de unión ────────────────────────────
  if (!myRole) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-bg-surface-alt">
          <Icon name="megaphone" size={24} className="text-fg-muted" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-fg-primary">{channel.title ?? `#${channel.slug}`}</h1>
          {channel.topic && <p className="mt-1 max-w-sm text-sm text-fg-muted">{channel.topic}</p>}
          <p className="mt-1 font-mono text-[11px] text-fg-muted">{channel.contextId}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => joinChannelAction({ conversationId: channel.id }))}
          className="btn btn-primary btn-sm"
        >
          <Icon name="plus" size={14} /> Unirme a este canal
        </button>
        {err && <p className="text-xs text-tops-red">{err}</p>}
      </div>
    );
  }

  // ── Miembro: vista completa (read-only si archivado) ─────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header + moderación */}
      <header className="flex items-start justify-between gap-3 border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="megaphone" size={15} className="text-fg-secondary" />
            {editingTitle ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  maxLength={120}
                  aria-label="Nombre del canal"
                  className="w-64 rounded border border-stroke-soft bg-bg-page px-2 py-1 text-sm font-bold text-fg-primary outline-none focus:border-tops-red"
                  placeholder="Nombre del canal…"
                />
                <button type="button" className="btn btn-primary btn-sm" disabled={busy}
                  onClick={async () => { if (await run(() => setTitleAction({ conversationId: channel.id, title: titleDraft }))) setEditingTitle(false); }}>
                  <Icon name="check" size={13} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingTitle(false)}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            ) : (
              <>
                <h2 className="truncate text-sm font-bold text-fg-primary">{channel.title ?? `#${channel.slug}`}</h2>
                {canModerateActive && (
                  <button type="button" className="text-[11px] text-fg-link hover:underline" title="Renombrar canal"
                    onClick={() => { setTitleDraft(channel.title ?? ""); setEditingTitle(true); }}>
                    editar
                  </button>
                )}
              </>
            )}
            <span className="chip text-[10px]">{channel.visibility === "public" ? "Público" : "Privado"}</span>
            {archived && (
              <span className="chip text-[10px] bg-amber-400/15 text-amber-500">
                <Icon name="folder" size={10} /> Archivado
              </span>
            )}
          </div>
          {editingTopic ? (
            <div className="mt-1 flex items-center gap-1.5">
              <input
                value={topicDraft}
                onChange={(e) => setTopicDraft(e.target.value)}
                maxLength={280}
                aria-label="Tema del canal"
                className="w-72 rounded border border-stroke-soft bg-bg-page px-2 py-1 text-xs text-fg-primary outline-none focus:border-tops-red"
                placeholder="Tema del canal…"
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={busy}
                onClick={async () => { if (await run(() => setTopicAction({ conversationId: channel.id, topic: topicDraft }))) setEditingTopic(false); }}>
                <Icon name="check" size={13} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingTopic(false)}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ) : (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-fg-muted">
              <span className="font-mono">{channel.contextId}</span>
              {channel.topic ? <span>· {channel.topic}</span> : <span className="italic">sin tema</span>}
              {canModerateActive && (
                <button type="button" className="text-fg-link hover:underline" title="Editar tema" onClick={() => { setTopicDraft(channel.topic ?? ""); setEditingTopic(true); }}>
                  editar tema
                </button>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowMembers((s) => !s)}>
            <Icon name="users" size={14} /> {members.length}
          </button>
          {canModerateActive && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void archive()}>
              <Icon name="folder" size={14} /> Archivar
            </button>
          )}
        </div>
      </header>

      {archived && (
        <p className="flex items-center gap-1.5 border-b border-stroke-soft bg-amber-400/10 px-4 py-1.5 text-[12px] text-fg-secondary">
          <Icon name="folder" size={13} className="text-amber-500" />
          Canal archivado — solo lectura. No se pueden enviar mensajes ni modificar el canal.
        </p>
      )}

      {err && <p className="border-b border-stroke-soft bg-tops-red/5 px-4 py-1.5 text-xs text-tops-red">{err}</p>}

      {/* Fijados */}
      {pinned.length > 0 && (
        <div className="border-b border-stroke-soft bg-bg-surface-alt/50 px-4 py-2">
          <button type="button" className="flex items-center gap-1.5 text-[11px] font-semibold text-fg-secondary"
            onClick={() => setShowPinned((s) => !s)}>
            <Icon name="tag-alt" size={12} className="text-tops-red" /> {pinned.length} fijado{pinned.length > 1 ? "s" : ""}
            <Icon name={showPinned ? "chevron-down" : "chevron-right"} size={12} />
          </button>
          {showPinned && (
            <ul className="mt-1.5 space-y-1">
              {pinned.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded bg-bg-surface px-2 py-1 text-[12px]">
                  <span className="min-w-0 truncate text-fg-primary">
                    {p.authorName && <span className="font-semibold text-fg-secondary">{p.authorName}: </span>}
                    {p.body ?? "—"}
                  </span>
                  {canModerateActive && (
                    <button type="button" className="shrink-0 text-fg-muted hover:text-tops-red" title="Desfijar" disabled={busy}
                      onClick={() => void run(() => unpinMessageAction({ messageId: p.messageId }))}>
                      <Icon name="x" size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Cuerpo: hilo (reusa ThreadView de RC1.1) + panel de miembros */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">
          <ThreadView conversationId={channel.id} initialMessages={initialMessages} currentUserId={currentUserId ?? null} readOnly={archived} />
        </div>

        {showMembers && (
          <aside className="flex w-64 shrink-0 flex-col border-l border-stroke-soft bg-bg-surface">
            <div className="flex items-center justify-between border-b border-stroke-soft px-3 py-2">
              <span className="text-xs font-bold text-fg-primary">Miembros · {members.length}</span>
              <button type="button" onClick={() => setShowMembers(false)} className="text-fg-muted hover:text-fg-primary">
                <Icon name="x" size={14} />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto p-2">
              {members.map((m) => {
                // DEFECT-2: identidad humana (nombre); nunca el UUID como etiqueta principal
                // (el profile_id queda como title/tooltip técnico secundario).
                const displayName = m.name ?? "Usuario interno";
                return (
                <li key={m.profileId ?? m.name} title={m.profileId ?? undefined} className="flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-bg-surface-alt">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg-surface-alt text-[10px] font-bold text-fg-secondary">
                    {m.avatar ?? displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] text-fg-primary">{displayName}</div>
                    {canManageRolesActive && m.profileId ? (
                      <select
                        value={m.memberRole}
                        aria-label={`Rol de ${displayName}`}
                        disabled={busy}
                        onChange={(e) => void run(() => setMemberRoleAction({ conversationId: channel.id, profileId: m.profileId!, role: e.target.value }))}
                        className="mt-0.5 rounded border border-stroke-soft bg-bg-page px-1 py-0.5 text-[10px] text-fg-secondary"
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : (
                      <div className="text-[10px] text-fg-muted">{ROLE_LABEL[m.memberRole]}</div>
                    )}
                  </div>
                  {canModerateActive && m.profileId && (
                    <button type="button" className="shrink-0 text-fg-muted hover:text-tops-red" title="Quitar" disabled={busy}
                      onClick={() => { if (confirm("¿Quitar miembro?")) void run(() => removeMemberAction({ conversationId: channel.id, profileId: m.profileId! })); }}>
                      <Icon name="minus" size={13} />
                    </button>
                  )}
                </li>
                );
              })}
            </ul>
            {canModerateActive && (
              <div className="border-t border-stroke-soft p-2">
                <MemberSearch
                  disabled={busy}
                  onAdd={(profileId) => run(() => addMemberAction({ conversationId: channel.id, profileId, role: "member" }))}
                />
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
