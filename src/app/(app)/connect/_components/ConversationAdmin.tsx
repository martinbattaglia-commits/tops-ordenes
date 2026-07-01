"use client";

// Nexus Link · superficie de administración compartida de conversación (canal/grupo). DEFECT-8/9/10.
// Extraído del "member view" de ChannelView (RC1.2) y generalizado: opera por conversationId, sirve a
// channels Y groups, y usa el gate canAdminister(myRole, isAdmin) (owner/moderator/admin). Se reutiliza en
// ChannelView (/connect/canales/[slug]) y en la ruta de conversación (/connect/c/[conversationId]).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import type { ChannelMember, PinnedItem } from "@/lib/connect/channel-mock";
import type { ConversationKind, ConversationLink, MemberRole, Message } from "@/lib/connect/types";
import { ENTITY_TYPE_LABELS } from "@/lib/connect/types";
import { canAdminister, canManageRoles } from "@/lib/connect/domain/channel";
import {
  setTitleAction, setTopicAction, archiveConversationAction,
  addMemberAction, removeMemberAction, setMemberRoleAction, unpinMessageAction,
} from "@/lib/connect/adapters/driving/channel-actions";
import { ThreadView } from "./ThreadView";
import { MemberSearch } from "./MemberSearch";

const ROLES: MemberRole[] = ["owner", "moderator", "member", "guest"];
const ROLE_LABEL: Record<MemberRole, string> = { owner: "Dueño", moderator: "Moderador", member: "Miembro", guest: "Invitado" };

export function ConversationAdmin({
  conversationId, kind, title, topic, slug, contextId, visibility, archivedAt,
  myRole, isAdmin, members = [], pinned = [], initialMessages = [], currentUserId,
  links = [], archiveRedirectTo,
}: {
  conversationId: string;
  kind: ConversationKind;
  title: string | null;
  topic: string | null;
  slug: string | null;
  contextId: string;
  visibility: "public" | "private" | null;
  archivedAt: string | null;
  myRole: MemberRole | null;
  isAdmin: boolean;
  members?: ChannelMember[];
  pinned?: PinnedItem[];
  initialMessages?: Message[];
  currentUserId?: string | null;
  /** Vínculos ERP (chips de contexto). Opcional — se muestran en la ruta de conversación. */
  links?: ConversationLink[];
  /** A dónde ir tras archivar: /connect/canales (vista de canal) o /connect (ruta de conversación). */
  archiveRedirectTo: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showPinned, setShowPinned] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title ?? "");
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState(topic ?? "");
  const [err, setErr] = useState<string | null>(null);

  const archived = !!archivedAt;
  const isChannel = kind === "channel";
  const noun = isChannel ? "canal" : "grupo";
  const nounCap = isChannel ? "Canal" : "Grupo";
  // DEFECT-9: administra owner/moderator O admin/superadmin. Archivado deshabilita acciones activas.
  const canAdminActive = canAdminister(myRole, isAdmin) && !archived;
  const canManageRolesActive = (canManageRoles(myRole) || isAdmin) && !archived;
  const displayTitle = title ?? (slug ? `#${slug}` : "Conversación");

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true); setErr(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setErr(r.message ?? "Acción fallida.");
    else router.refresh();
    return r.ok;
  }

  // DEFECT-6: al archivar, redirigir fuera + refrescar (actualiza sidebar/listados).
  async function archive() {
    if (!confirm(`¿Archivar este ${noun}? Dejará de aparecer en el listado activo.`)) return;
    setBusy(true); setErr(null);
    const r = await archiveConversationAction({ conversationId });
    setBusy(false);
    if (!r.ok) { setErr(r.message ?? "No se pudo archivar."); return; }
    router.push(archiveRedirectTo);
    router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header + administración */}
      <header className="flex items-start justify-between gap-3 border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name={isChannel ? "megaphone" : "users"} size={15} className="text-fg-secondary" />
            {editingTitle ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  maxLength={120}
                  aria-label={`Nombre del ${noun}`}
                  className="w-64 rounded border border-stroke-soft bg-bg-page px-2 py-1 text-sm font-bold text-fg-primary outline-none focus:border-tops-red"
                  placeholder={`Nombre del ${noun}…`}
                />
                <button type="button" className="btn btn-primary btn-sm" disabled={busy}
                  onClick={async () => { if (await run(() => setTitleAction({ conversationId, title: titleDraft }))) setEditingTitle(false); }}>
                  <Icon name="check" size={13} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingTitle(false)}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            ) : (
              <>
                <h2 className="truncate text-sm font-bold text-fg-primary">{displayTitle}</h2>
                {canAdminActive && (
                  <button type="button" className="text-[11px] text-fg-link hover:underline" title={`Renombrar ${noun}`}
                    onClick={() => { setTitleDraft(title ?? ""); setEditingTitle(true); }}>
                    editar
                  </button>
                )}
              </>
            )}
            {isChannel && (
              <span className="chip text-[10px]">{visibility === "public" ? "Público" : "Privado"}</span>
            )}
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
                aria-label={`Tema del ${noun}`}
                className="w-72 rounded border border-stroke-soft bg-bg-page px-2 py-1 text-xs text-fg-primary outline-none focus:border-tops-red"
                placeholder={`Tema del ${noun}…`}
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={busy}
                onClick={async () => { if (await run(() => setTopicAction({ conversationId, topic: topicDraft }))) setEditingTopic(false); }}>
                <Icon name="check" size={13} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingTopic(false)}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ) : (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-fg-muted">
              <span className="font-mono">{contextId}</span>
              {topic ? <span>· {topic}</span> : <span className="italic">sin tema</span>}
              {canAdminActive && (
                <button type="button" className="text-fg-link hover:underline" title="Editar tema" onClick={() => { setTopicDraft(topic ?? ""); setEditingTopic(true); }}>
                  editar tema
                </button>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {links.map((l) => (
            <span key={l.id} className="chip text-[10px]" title={l.entityId ?? l.entityIdText ?? ""}>
              <Icon name="database" size={11} className="text-fg-link" />
              {ENTITY_TYPE_LABELS[l.entityType]}
            </span>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowMembers((s) => !s)}>
            <Icon name="users" size={14} /> {members.length}
          </button>
          {canAdminActive && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void archive()}>
              <Icon name="folder" size={14} /> Archivar
            </button>
          )}
        </div>
      </header>

      {archived && (
        <p className="flex items-center gap-1.5 border-b border-stroke-soft bg-amber-400/10 px-4 py-1.5 text-[12px] text-fg-secondary">
          <Icon name="folder" size={13} className="text-amber-500" />
          {nounCap} archivado — solo lectura. No se pueden enviar mensajes ni modificar {isChannel ? "el canal" : "el grupo"}.
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
                  {canAdminActive && (
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

      {/* Cuerpo: hilo + panel de miembros */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">
          <ThreadView conversationId={conversationId} initialMessages={initialMessages} currentUserId={currentUserId ?? null} readOnly={archived} />
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
                        onChange={(e) => void run(() => setMemberRoleAction({ conversationId, profileId: m.profileId!, role: e.target.value }))}
                        className="mt-0.5 rounded border border-stroke-soft bg-bg-page px-1 py-0.5 text-[10px] text-fg-secondary"
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : (
                      <div className="text-[10px] text-fg-muted">{ROLE_LABEL[m.memberRole]}</div>
                    )}
                  </div>
                  {canAdminActive && m.profileId && (
                    <button type="button" className="shrink-0 text-fg-muted hover:text-tops-red" title="Quitar" disabled={busy}
                      onClick={() => { if (confirm("¿Quitar miembro?")) void run(() => removeMemberAction({ conversationId, profileId: m.profileId! })); }}>
                      <Icon name="minus" size={13} />
                    </button>
                  )}
                </li>
                );
              })}
            </ul>
            {canAdminActive && (
              <div className="border-t border-stroke-soft p-2">
                <MemberSearch
                  disabled={busy}
                  onAdd={(profileId) => run(() => addMemberAction({ conversationId, profileId, role: "member" }))}
                />
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
