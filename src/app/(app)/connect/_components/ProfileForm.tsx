"use client";

// Perfil de Usuario (RC1.4) — formulario. Sin IA. Interactividad: presencia (write-on-change),
// avatar, frecuencia de notificaciones, firma y tema (guardado explícito). Estado ok/error inline.

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import {
  type UserProfile,
  type PresenceStatus,
  type NotifFreq,
  PRESENCE_LABELS,
  NOTIF_FREQ_LABELS,
  initialsFrom,
} from "@/lib/profile/types";
import { setPresenceAction, updateMyProfileAction } from "@/lib/profile/actions";

const PRESENCE_ORDER: PresenceStatus[] = ["online", "idle", "busy", "offline"];
const NOTIF_ORDER: NotifFreq[] = ["instant", "daily", "weekly", "mute"];
const THEME_ORDER = ["system", "light", "dark"] as const;
type Theme = (typeof THEME_ORDER)[number];
const THEME_LABELS: Record<Theme, string> = { system: "Sistema", light: "Claro", dark: "Oscuro" };

const PRESENCE_DOT: Record<PresenceStatus, string> = {
  online: "bg-emerald-500",
  idle: "bg-amber-400",
  busy: "bg-tops-red",
  offline: "bg-fg-muted",
};

type Status = { kind: "idle" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

export function ProfileForm({ profile }: { profile: UserProfile }) {
  const initialTheme: Theme =
    profile.preferences.theme === "light" || profile.preferences.theme === "dark"
      ? profile.preferences.theme
      : "system";

  const [presence, setPresence] = useState<PresenceStatus>(profile.presence);
  const [avatarUrl, setAvatarUrl] = useState<string>(profile.avatarUrl ?? "");
  const [notifFreq, setNotifFreq] = useState<NotifFreq>(profile.notifFreq);
  const [signature, setSignature] = useState<string>(
    typeof profile.preferences.signature === "string" ? profile.preferences.signature : "",
  );
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [imgBroken, setImgBroken] = useState(false);

  const [presenceStatus, setPresenceStatus] = useState<Status>({ kind: "idle" });
  const [saveStatus, setSaveStatus] = useState<Status>({ kind: "idle" });
  const [presencePending, startPresence] = useTransition();
  const [savePending, startSave] = useTransition();

  const liveInitials = initialsFrom(profile.fullName) || profile.initials;
  const trimmedAvatar = avatarUrl.trim();

  function onPresenceChange(next: PresenceStatus) {
    const prev = presence;
    setPresence(next);
    setPresenceStatus({ kind: "idle" });
    startPresence(async () => {
      const r = await setPresenceAction({ status: next });
      if (r.ok) {
        setPresenceStatus({ kind: "ok", message: "Presencia actualizada." });
      } else {
        setPresence(prev);
        setPresenceStatus({ kind: "error", message: r.message });
      }
    });
  }

  function onSave() {
    setSaveStatus({ kind: "idle" });
    startSave(async () => {
      const r = await updateMyProfileAction({
        avatarUrl: trimmedAvatar.length > 0 ? trimmedAvatar : null,
        notifFreq,
        preferences: { ...profile.preferences, signature, theme },
      });
      if (r.ok) setSaveStatus({ kind: "ok", message: "Perfil guardado." });
      else setSaveStatus({ kind: "error", message: r.message });
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-6">
      {/* (1) Cabecera con avatar + identidad + selector de presencia */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          {trimmedAvatar.length > 0 && !imgBroken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={trimmedAvatar}
              alt={profile.fullName ?? "Avatar"}
              onError={() => setImgBroken(true)}
              className="h-16 w-16 shrink-0 rounded-full border border-stroke-soft object-cover"
            />
          ) : (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-bg-surface-alt text-lg font-bold text-fg-secondary">
              {liveInitials}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-fg-primary">
              {profile.fullName ?? "Sin nombre"}
            </h2>
            {profile.email && <p className="truncate text-sm text-fg-secondary">{profile.email}</p>}
            <span className="mt-1.5 inline-flex items-center rounded-pill bg-bg-surface-alt px-2.5 py-0.5 text-[11px] font-medium text-fg-secondary">
              {profile.role}
            </span>
          </div>
        </div>

        <div className="mt-4 border-t border-stroke-soft pt-4">
          <label className="block text-xs font-medium text-fg-secondary">Presencia</label>
          <div className="mt-2 flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRESENCE_DOT[presence]}`} aria-hidden />
            <select
              value={presence}
              aria-label="Presencia"
              disabled={presencePending}
              onChange={(e) => onPresenceChange(e.target.value as PresenceStatus)}
              className="rounded border border-stroke-soft bg-bg-page px-2 py-1.5 text-sm text-fg-primary outline-none focus:border-tops-red disabled:opacity-60"
            >
              {PRESENCE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {PRESENCE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          {presenceStatus.kind === "ok" && (
            <p className="mt-1.5 text-xs text-emerald-500">{presenceStatus.message}</p>
          )}
          {presenceStatus.kind === "error" && (
            <p className="mt-1.5 text-xs text-tops-red">{presenceStatus.message}</p>
          )}
        </div>
      </div>

      {/* Preferencias (guardado explícito) */}
      <div className="card mt-4 p-5">
        <h3 className="text-sm font-bold text-fg-primary">Preferencias</h3>

        <div className="mt-4 space-y-4">
          {/* (2) Avatar URL */}
          <label className="block text-xs font-medium text-fg-secondary">
            URL de avatar
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => { setAvatarUrl(e.target.value); setImgBroken(false); }}
              placeholder="https://…"
              className="mt-1 w-full rounded border border-stroke-soft bg-bg-page px-2.5 py-1.5 text-sm text-fg-primary outline-none focus:border-tops-red"
            />
          </label>

          {/* (3) Frecuencia de notificaciones */}
          <label className="block text-xs font-medium text-fg-secondary">
            Frecuencia de notificaciones
            <select
              value={notifFreq}
              onChange={(e) => setNotifFreq(e.target.value as NotifFreq)}
              className="mt-1 w-full rounded border border-stroke-soft bg-bg-page px-2.5 py-1.5 text-sm text-fg-primary outline-none focus:border-tops-red"
            >
              {NOTIF_ORDER.map((f) => (
                <option key={f} value={f}>
                  {NOTIF_FREQ_LABELS[f]}
                </option>
              ))}
            </select>
          </label>

          {/* (4) Firma + tema */}
          <label className="block text-xs font-medium text-fg-secondary">
            Firma
            <textarea
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              rows={3}
              placeholder="Tu firma para mensajes y notificaciones…"
              className="mt-1 w-full resize-y rounded border border-stroke-soft bg-bg-page px-2.5 py-1.5 text-sm text-fg-primary outline-none focus:border-tops-red"
            />
          </label>

          <label className="block text-xs font-medium text-fg-secondary">
            Tema
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="mt-1 w-full rounded border border-stroke-soft bg-bg-page px-2.5 py-1.5 text-sm text-fg-primary outline-none focus:border-tops-red"
            >
              {THEME_ORDER.map((t) => (
                <option key={t} value={t}>
                  {THEME_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-stroke-soft pt-4">
          <button type="button" className="btn btn-primary btn-sm" disabled={savePending} onClick={onSave}>
            <Icon name="check" size={14} /> {savePending ? "Guardando…" : "Guardar"}
          </button>
          {saveStatus.kind === "ok" && <p className="text-xs text-emerald-500">{saveStatus.message}</p>}
          {saveStatus.kind === "error" && <p className="text-xs text-tops-red">{saveStatus.message}</p>}
        </div>
      </div>
    </div>
  );
}
