"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { ChannelItem, MemberRole } from "@/lib/connect/types";
import type { ChannelMember, PinnedItem } from "@/lib/connect/channel-mock";
import type { Message } from "@/lib/connect/types";
import { canModerate, canManageRoles } from "@/lib/connect/domain/channel";
import {
  joinChannelAction, setTopicAction, archiveConversationAction,
  addMemberAction, removeMemberAction, setMemberRoleAction, unpinMessageAction,
} from "@/lib/connect/adapters/driving/channel-actions";
import { ThreadView } from "./ThreadView";

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
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState(channel.topic ?? "");
  const [newMember, setNewMember] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const moderator = canModerate(myRole);

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true); setErr(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setErr(r.message ?? "Acción fallida.");
    else router.refresh();
    return r.ok;
  }

  // ── No-miembro: vista de unión ──────────────────────────────────────────
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

  // ── Miembro: vista completa ─────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header + moderación */}
      <header className="flex items-start justify-between gap-3 border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="megaphone" size={15} className="text-fg-secondary" />
            <h2 className="truncate text-sm font-bold text-fg-primary">{channel.title ?? `#${channel.slug}`}</h2>
            <span className="chip text-[10px]">{channel.visibility === "public" ? "Público" : "Privado"}</span>
          </div>
          {editingTopic ? (
            <div className="mt-1 flex items-center gap-1.5">
              <input
                value={topicDraft}
                onChange={(e) => setTopicDraft(e.target.value)}
                maxLength={280}
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
              {moderator && (
                <button type="button" className="text-fg-link hover:underline" onClick={() => { setTopicDraft(channel.topic ?? ""); setEditingTopic(true); }}>
                  editar
                </button>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowMembers((s) => !s)}>
            <Icon name="users" size={14} /> {members.length}
          </button>
          {moderator && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => { if (confirm("¿Archivar este canal?")) void run(() => archiveConversationAction({ conversationId: channel.id })); }}>
              <Icon name="folder" size={14} /> Archivar
            </button>
          )}
        </div>
      </header>

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
                  {moderator && (
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
          <ThreadView conversationId={channel.id} initialMessages={initialMessages} currentUserId={currentUserId ?? null} />
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
              {members.map((m) => (
                <li key={m.profileId ?? m.name} className="flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-bg-surface-alt">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg-surface-alt text-[10px] font-bold text-fg-secondary">
                    {m.avatar ?? (m.name ?? "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] text-fg-primary">{m.name ?? m.profileId ?? "—"}</div>
                    {canManageRoles(myRole) && m.profileId ? (
                      <select
                        value={m.memberRole}
                        aria-label={`Rol de ${m.name ?? "miembro"}`}
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
                  {moderator && m.profileId && (
                    <button type="button" className="shrink-0 text-fg-muted hover:text-tops-red" title="Quitar" disabled={busy}
                      onClick={() => { if (confirm("¿Quitar miembro?")) void run(() => removeMemberAction({ conversationId: channel.id, profileId: m.profileId! })); }}>
                      <Icon name="minus" size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {moderator && (
              <div className="border-t border-stroke-soft p-2">
                <div className="flex items-center gap-1.5">
                  <input value={newMember} onChange={(e) => setNewMember(e.target.value)} placeholder="profile_id (uuid)" aria-label="ID de miembro (UUID)"
                    className="min-w-0 flex-1 rounded border border-stroke-soft bg-bg-page px-2 py-1 text-[11px] text-fg-primary outline-none focus:border-tops-red" />
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy || !newMember.trim()}
                    onClick={async () => { if (await run(() => addMemberAction({ conversationId: channel.id, profileId: newMember.trim(), role: "member" }))) setNewMember(""); }}>
                    <Icon name="plus" size={13} />
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-fg-muted">Agregar por ID (selector de usuarios: fase posterior).</p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
