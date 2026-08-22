"use client";

// Formulario de Perfil de Usuario (RC1.4 / P2).
// Restaura la funcionalidad completa canónica: Presencia en tiempo real (setPresenceAction),
// Firma de mensajes con VoiceField, Frecuencia de notificaciones, Tema visual y gestión segura de Avatar.
// Fail-closed, sin IA, y con limpieza explícita de Object URLs.

import { useState, useTransition, useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import { VoiceField } from "@/components/voice/VoiceField";
import {
  type PresenceStatus,
  type NotifFreq,
  type UserProfile,
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
const THEME_LABELS: Record<Theme, string> = {
  system: "Automático del sistema",
  light: "Modo Claro",
  dark: "Modo Oscuro",
};

const PRESENCE_DOT: Record<PresenceStatus, string> = {
  online: "bg-emerald-500",
  idle: "bg-amber-400",
  busy: "bg-tops-red",
  offline: "bg-fg-muted",
};

type Status = { kind: "idle" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

export function ProfileForm({
  profile,
  onSaved,
}: {
  profile: UserProfile;
  onSaved?: (updated: UserProfile) => void;
}) {
  const initialTheme: Theme =
    profile.preferences.theme === "light" || profile.preferences.theme === "dark"
      ? profile.preferences.theme
      : "system";

  // Estados de campos del perfil
  const [presence, setPresence] = useState<PresenceStatus>(profile.presence);
  const [notifFreq, setNotifFreq] = useState<NotifFreq>(profile.notifFreq);
  const [signature, setSignature] = useState<string>(
    typeof profile.preferences.signature === "string" ? profile.preferences.signature : "",
  );
  const [theme, setTheme] = useState<Theme>(initialTheme);

  // Estados de avatar y vista previa
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Feedback y transiciones
  const [presenceStatus, setPresenceStatus] = useState<Status>({ kind: "idle" });
  const [saveStatus, setSaveStatus] = useState<Status>({ kind: "idle" });
  const [avatarStatus, setAvatarStatus] = useState<Status>({ kind: "idle" });
  const [presencePending, startPresence] = useTransition();
  const [savePending, startSave] = useTransition();
  const [avatarPending, startAvatar] = useTransition();

  // Limpieza segura de Object URL al desmontar o cambiar archivo
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setAvatarStatus({ kind: "error", message: "La imagen no puede superar los 2MB." });
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAvatarStatus({ kind: "error", message: "Formato no soportado. Usá JPG, PNG o WebP." });
      return;
    }

    // Revocar URL previa si existía
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const newObjUrl = URL.createObjectURL(file);
    objectUrlRef.current = newObjUrl;
    setLocalPreviewUrl(newObjUrl);
    setAvatarStatus({
      kind: "ok",
      message: "Vista previa local cargada. El almacenamiento persistente requiere bucket de infraestructura autorizado.",
    });
  }

  function handleRemoveAvatar() {
    setAvatarStatus({ kind: "idle" });
    startAvatar(async () => {
      // Limpiar preview local si existe
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
        setLocalPreviewUrl(null);
      }

      const res = await removeAvatarAction();
      if (res.ok) {
        setAvatarUrl(null);
        setAvatarStatus({ kind: "ok", message: "Foto de perfil eliminada." });
      } else {
        setAvatarStatus({ kind: "error", message: res.message });
      }
    });
  }

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
      const updates: {
        avatarUrl?: string | null;
        notifFreq?: NotifFreq;
        preferences?: Record<string, unknown>;
      } = {
        notifFreq,
        preferences: {
          ...profile.preferences,
          signature,
          theme,
        },
      };

      if (avatarUrl && avatarUrl.startsWith("https://")) {
        updates.avatarUrl = avatarUrl;
      } else if (avatarUrl === null) {
        updates.avatarUrl = null;
      }

      const res = await updateMyProfileAction(updates);
      if (res.ok) {
        setSaveStatus({ kind: "ok", message: "Perfil guardado." });
        onSaved?.({
          ...profile,
          presence,
          notifFreq,
          avatarUrl,
          preferences: {
            ...profile.preferences,
            signature,
            theme,
          },
        });
      } else {
        setSaveStatus({ kind: "error", message: res.message });
      }
    });
  }

  const liveInitials = initialsFrom(profile.fullName) || profile.initials;
  const currentAvatarSrc = localPreviewUrl ?? avatarUrl;

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-6 space-y-6">
      {/* (1) Cabecera con Avatar + Identidad + Selector de Presencia */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <Avatar
            src={currentAvatarSrc}
            name={profile.fullName}
            initials={liveInitials}
            size="lg"
          />

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-fg-primary">
              {profile.fullName ?? "Sin nombre"}
            </h2>
            {profile.email && <p className="truncate text-sm text-fg-secondary">{profile.email}</p>}
            <span className="mt-1.5 inline-flex items-center rounded-pill bg-bg-surface-alt px-2.5 py-0.5 text-[11px] font-medium text-fg-secondary">
              {profile.role}
            </span>

            {/* Controles de Foto de Perfil */}
            <div className="mt-3 flex items-center gap-2">
              <label
                htmlFor="avatar-upload"
                className="btn btn-secondary btn-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <Icon name="camera" size={12} />
                <span>Subir foto</span>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
              {(currentAvatarSrc || localPreviewUrl) && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={avatarPending}
                  className="btn btn-ghost btn-xs text-tops-red hover:bg-tops-red/10 inline-flex items-center gap-1"
                >
                  <Icon name="trash" size={12} />
                  <span>Quitar</span>
                </button>
              )}
            </div>

            {avatarStatus.kind === "ok" && (
              <p role="status" aria-live="polite" className="mt-1.5 text-[11px] text-emerald-500">{avatarStatus.message}</p>
            )}
            {avatarStatus.kind === "error" && (
              <p role="alert" aria-live="assertive" className="mt-1.5 text-[11px] text-tops-red">{avatarStatus.message}</p>
            )}
          </div>
        </div>

        {/* Selector de Presencia con transición en tiempo real */}
        <div className="mt-4 border-t border-stroke-soft pt-4">
          <label htmlFor="presence-select" className="block text-xs font-medium text-fg-secondary">Presencia</label>
          <div className="mt-2 flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRESENCE_DOT[presence]}`} aria-hidden />
            <select
              id="presence-select"
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
            <p role="status" aria-live="polite" className="mt-1.5 text-xs text-emerald-500">{presenceStatus.message}</p>
          )}
          {presenceStatus.kind === "error" && (
            <p role="alert" aria-live="assertive" className="mt-1.5 text-xs text-tops-red">{presenceStatus.message}</p>
          )}
        </div>
      </div>

      {/* (2) Preferencias del Usuario */}
      <div className="card p-5">
        <h3 className="text-sm font-bold text-fg-primary">Preferencias</h3>

        <div className="mt-4 space-y-4">
          {/* Frecuencia de notificaciones */}
          <div>
            <label htmlFor="notif-select" className="block text-xs font-medium text-fg-secondary">
              Frecuencia de notificaciones
            </label>
            <select
              id="notif-select"
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
          </div>

          {/* Firma con VoiceField */}
          <div>
            <label htmlFor="signature-input" className="block text-xs font-medium text-fg-secondary">
              Firma
            </label>
            <VoiceField>
              <textarea
                id="signature-input"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                rows={3}
                placeholder="Tu firma para mensajes y notificaciones…"
                className="mt-1 w-full resize-y rounded border border-stroke-soft bg-bg-page px-2.5 py-1.5 text-sm text-fg-primary outline-none focus:border-tops-red"
              />
            </VoiceField>
          </div>

          {/* Tema Visual */}
          <div>
            <label htmlFor="theme-select" className="block text-xs font-medium text-fg-secondary">
              Tema Visual
            </label>
            <select
              id="theme-select"
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
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-stroke-soft pt-4">
          <button
            type="button"
            className="btn btn-nexus btn-sm inline-flex items-center gap-1.5"
            disabled={savePending}
            onClick={onSave}
          >
            <Icon name="check" size={14} />
            <span>{savePending ? "Guardando…" : "Guardar Preferencias"}</span>
          </button>
          {saveStatus.kind === "ok" && <p role="status" aria-live="polite" className="text-xs text-emerald-500">{saveStatus.message}</p>}
          {saveStatus.kind === "error" && <p role="alert" aria-live="assertive" className="text-xs text-tops-red">{saveStatus.message}</p>}
        </div>
      </div>
    </div>
  );
}
