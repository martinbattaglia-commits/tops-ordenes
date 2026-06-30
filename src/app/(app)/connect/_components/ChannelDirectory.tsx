"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import type { ChannelItem, ConversationKind } from "@/lib/connect/types";
import { normalizeSlug, isValidSlug } from "@/lib/connect/domain/channel";
import { joinChannelAction } from "@/lib/connect/adapters/driving/channel-actions";
import { createConversationAction } from "@/lib/connect/adapters/driving/conversation-actions";

export function ChannelDirectory({ channels }: { channels: ChannelItem[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<ConversationKind>("channel");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const slug = normalizeSlug(name);

  async function join(c: ChannelItem) {
    setBusy(true); setErr(null);
    const r = await joinChannelAction({ conversationId: c.id });
    setBusy(false);
    if (!r.ok) setErr(r.message);
    else if (c.slug) router.push(`/connect/canales/${c.slug}`);
    else router.refresh();
  }

  async function create() {
    if (kind === "channel" && !isValidSlug(slug)) { setErr("El nombre del canal no produce un slug válido."); return; }
    setBusy(true); setErr(null);
    const r = await createConversationAction({
      kind, title: name.trim() || null,
      slug: kind === "channel" ? slug : null,
      visibility: kind === "channel" ? visibility : null,
      memberProfileIds: [],
    });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    setCreating(false); setName("");
    if (kind === "channel") router.push(`/connect/canales/${slug}`);
    else router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow-tiny">Nexus Link</div>
          <h1 className="page-title">Canales</h1>
          <p className="page-subtitle">Descubrí y unite a canales públicos, o creá un canal/grupo.</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating((s) => !s)}>
          <Icon name="plus" size={14} /> Crear
        </button>
      </div>

      {creating && (
        <div className="card mb-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-fg-secondary">
              Nombre
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Operaciones Magaldi"
                className="mt-1 w-full rounded border border-stroke-soft bg-bg-page px-2 py-1.5 text-sm text-fg-primary outline-none focus:border-tops-red" />
            </label>
            <label className="text-xs text-fg-secondary">
              Tipo
              <select value={kind} onChange={(e) => setKind(e.target.value as ConversationKind)}
                className="mt-1 w-full rounded border border-stroke-soft bg-bg-page px-2 py-1.5 text-sm text-fg-primary">
                <option value="channel">Canal</option>
                <option value="group">Grupo</option>
              </select>
            </label>
            {kind === "channel" && (
              <>
                <label className="text-xs text-fg-secondary">
                  Slug
                  <input value={slug} readOnly
                    className="mt-1 w-full rounded border border-stroke-soft bg-bg-surface-alt px-2 py-1.5 font-mono text-xs text-fg-muted" />
                </label>
                <label className="text-xs text-fg-secondary">
                  Visibilidad
                  <select value={visibility} onChange={(e) => setVisibility(e.target.value as "public" | "private")}
                    className="mt-1 w-full rounded border border-stroke-soft bg-bg-page px-2 py-1.5 text-sm text-fg-primary">
                    <option value="public">Público (cualquiera se une)</option>
                    <option value="private">Privado (solo por invitación)</option>
                  </select>
                </label>
              </>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !name.trim()} onClick={() => void create()}>
              Crear {kind === "channel" ? "canal" : "grupo"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {err && <p className="mb-3 text-xs text-tops-red">{err}</p>}

      <div className="space-y-2">
        {channels.length === 0 && <p className="text-sm text-fg-muted">No hay canales todavía.</p>}
        {channels.map((c) => (
          <div key={c.id} className="card flex items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg-surface-alt">
                <Icon name="megaphone" size={16} className="text-fg-secondary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-fg-primary">{c.title ?? `#${c.slug}`}</span>
                  <span className="chip text-[10px]">{c.visibility === "public" ? "Público" : "Privado"}</span>
                </div>
                <p className="truncate text-[12px] text-fg-muted">{c.topic ?? `#${c.slug ?? ""}`}</p>
              </div>
            </div>
            <div className="shrink-0">
              {c.isMember ? (
                <Link href={`/connect/canales/${c.slug}`} className="btn btn-ghost btn-sm">Abrir</Link>
              ) : c.visibility === "public" ? (
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void join(c)}>
                  <Icon name="plus" size={13} /> Unirme
                </button>
              ) : (
                <span className="chip text-[10px]"><Icon name="lock" size={11} /> Privado</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
