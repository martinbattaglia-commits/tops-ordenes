"use client";

// Nexus Link · vista de canal (/connect/canales/[slug]). Conserva las ramas específicas de canal
// (no-miembro: unión / archivado) y delega la administración al componente compartido
// ConversationAdmin (DEFECT-8/9/10). El gate admin (owner/moderator/admin) vive en ConversationAdmin.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import type { ChannelItem, MemberRole } from "@/lib/connect/types";
import type { ChannelMember, PinnedItem } from "@/lib/connect/channel-mock";
import type { Message } from "@/lib/connect/types";
import { joinChannelAction } from "@/lib/connect/adapters/driving/channel-actions";
import { ConversationAdmin } from "./ConversationAdmin";

export function ChannelView({
  channel, myRole, isAdmin = false, members = [], pinned = [], initialMessages = [], currentUserId,
}: {
  channel: ChannelItem;
  myRole: MemberRole | null;
  isAdmin?: boolean;
  members?: ChannelMember[];
  pinned?: PinnedItem[];
  initialMessages?: Message[];
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const archived = !!channel.archivedAt;

  async function join() {
    setBusy(true); setErr(null);
    const r = await joinChannelAction({ conversationId: channel.id });
    setBusy(false);
    if (!r.ok) { setErr(r.message ?? "No se pudo unir al canal."); return; }
    router.refresh();
  }

  // ── Archivado + no-miembro (no admin): sin acción de unión ────────────────
  if (archived && !myRole && !isAdmin) {
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

  // ── No-miembro (no admin), canal activo: vista de unión ───────────────────
  if (!myRole && !isAdmin) {
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
        <button type="button" disabled={busy} onClick={() => void join()} className="btn btn-primary btn-sm">
          <Icon name="plus" size={14} /> Unirme a este canal
        </button>
        {err && <p className="text-xs text-tops-red">{err}</p>}
      </div>
    );
  }

  // ── Miembro o admin/superadmin: superficie de administración compartida ───
  return (
    <ConversationAdmin
      conversationId={channel.id}
      kind="channel"
      title={channel.title}
      topic={channel.topic}
      slug={channel.slug}
      contextId={channel.contextId}
      visibility={channel.visibility}
      archivedAt={channel.archivedAt}
      myRole={myRole}
      isAdmin={isAdmin}
      members={members}
      pinned={pinned}
      initialMessages={initialMessages}
      currentUserId={currentUserId}
      archiveRedirectTo="/connect/canales"
    />
  );
}
