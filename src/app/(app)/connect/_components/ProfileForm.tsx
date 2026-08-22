"use client";

// Nexus Link · Perfil de Usuario (RC1.4 / P2). Formulario de preferencias: presencia,
// avatar (carga local de archivo, URL externa, eliminación), notificaciones, firma y tema.
// Estado ok/error inline y accesible.

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { VoiceField } from "@/components/voice/VoiceField";
import {
  type UserProfile,
  type PresenceStatus,
  type NotifFreq,
  PRESENCE_ORDER,
  PRESENCE_LABELS,
  NOTIF_ORDER,
  NOTIF_FREQ_LABELS,
  THEME_ORDER,
  initialsFrom,
} from "@/lib/profile/types";
import {
  setPresenceAction,
  updateMyProfileAction,
  removeAvatarAction,
} from "@/lib/profile/actions";
import { Avatar } from "./Avatar";

type Theme = (typeof THEME_ORDER)[number];
const THEME_LABELS: Record<Theme, string> = { system: "Sistema", light: "Claro", dark: "Oscuro" };

const PRESENCE_DOT: Record<PresenceStatus, string> = {
  online: "bg-emerald-500",
  idle: "bg-amber-400",
  busy: "bg-tops-red",
  offline: "bg-fg-muted",
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

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
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [presenceStatus, setPresenceStatus] = useState<Status>({ kind: "idle" });
  const [saveStatus, setSaveStatus] = useState<Status>({ kind: "idle" });
  const [presencePending, startPresence] = useTransition();
  const [savePending, startSave] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setAvatarError("Formato no soportado. Usá JPG, PNG o WebP.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("La imagen supera el límite de 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarUrl(reader.result);
      }
    };
    reader.onerror = () => {
      setAvatarError("No se pudo leer el archivo de imagen.");
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveAvatar() {
    setAvatarUrl("");
    setAvatarError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    startSave(async () => {
      await removeAvatarAction();
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
      if (r.ok) setSaveStatus({ kind: "ok", message: "Perfil guardado correctamente." });
      else setSaveStatus({ kind: "error", message: r.message });
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-6">
      {/* (1) Cabecera con avatar + identidad + selector de presencia */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="relative group">
            <Avatar
              src={trimmedAvatar.length > 0 ? trimmedAvatar : null}
              name={profile.fullName}
              initials={profile.initials || initialsFrom(profile.fullName)}
              size="lg"
            />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-fg-primary">
              {profile.fullName ?? "Sin nombre"}
            </h2>
            {profile.email && <p className="truncate text-sm text-fg-secondary">{profile.email}</p>}
            <span className="mt-1.5 inline-flex items-center rounded-pill bg-bg-surface-alt px-2.5 py-0.5 text-[11px] font-medium text-fg-secondary">
              {profile.role}
            </span>

            {/* Controles rápidos de foto de perfil */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleFileSelect}
                className="sr-only"
                id="avatar-file-upload"
              />
              <label
                htmlFor="avatar-file-upload"
                className="btn btn-ghost btn-sm text-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <Icon name="camera" size={13} />
                Subir foto
              </label>
              {trimmedAvatar.length > 0 && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={savePending}
                  className="btn btn-ghost btn-sm text-xs text-tops-red hover:bg-tops-red/10 inline-flex items-center gap-1.5"
                >
                  <Icon name="trash" size={13} />
                  Quitar foto
                </button>
              )}
            </div>
            {avatarError && (
              <p role="alert" className="mt-1.5 text-xs text-tops-red font-medium">
                {avatarError}
              </p>
            )}
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
          {/* (2) Avatar URL alternativa */}
          <label className="block text-xs font-medium text-fg-secondary">
            URL externa de avatar (opcional)
            <input
              type="url"
              value={avatarUrl.startsWith("data:") ? "" : avatarUrl}
              onChange={(e) => {
                setAvatarUrl(e.target.value);
                setAvatarError(null);
              }}
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
            <VoiceField>
              <textarea
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                rows={3}
                placeholder="Tu firma para mensajes y notificaciones…"
                className="mt-1 w-full resize-y rounded border border-stroke-soft bg-bg-page px-2.5 py-1.5 text-sm text-fg-primary outline-none focus:border-tops-red"
              />
            </VoiceField>
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
          <button type="button" className="btn btn-nexus btn-sm" disabled={savePending} onClick={onSave}>
            <Icon name="check" size={14} /> {savePending ? "Guardando…" : "Guardar"}
          </button>
          {saveStatus.kind === "ok" && <p className="text-xs text-emerald-500">{saveStatus.message}</p>}
          {saveStatus.kind === "error" && <p className="text-xs text-tops-red">{saveStatus.message}</p>}
        </div>
      </div>
    </div>
  );
}
