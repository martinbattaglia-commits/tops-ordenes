"use client";

// Formulario de Perfil de Usuario (RC1.4 / P2).
// Permite actualizar presencia, frecuencia de notificaciones y foto de perfil.
// Fail-closed, sin IA, y con fallback canónico a iniciales.

import { useState } from "react";
import { Icon } from "@/components/Icon";
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
import { updateMyProfileAction, removeAvatarAction } from "@/lib/profile/actions";
import { Avatar } from "./Avatar";

export function ProfileForm({
  profile,
  onSaved,
}: {
  profile: UserProfile;
  onSaved?: (updated: UserProfile) => void;
}) {
  const [presence, setPresence] = useState<PresenceStatus>(profile.presence);
  const [notifFreq, setNotifFreq] = useState<NotifFreq>(profile.notifFreq);
  const [theme, setTheme] = useState<string>(profile.preferences.theme || "system");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
  const [preview, setPreview] = useState<string | null>(profile.avatarUrl);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErr("La imagen no puede superar los 2MB.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setErr("Formato no soportado. Usá JPG, PNG o WebP.");
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setMsg("Foto seleccionada para vista previa local. El almacenamiento persistente requiere bucket autorizado.");
  }

  async function handleRemoveAvatar() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await removeAvatarAction();
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setAvatarUrl(null);
      setPreview(null);
      setMsg("Foto de perfil eliminada.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    setMsg(null);

    try {
      const updates: {
        avatarUrl?: string | null;
        notifFreq?: NotifFreq;
        preferences?: Record<string, unknown>;
      } = {
        notifFreq,
        preferences: {
          ...profile.preferences,
          theme: theme as "system" | "light" | "dark",
        },
      };

      // Si hay una URL HTTPS válida, se incluye en la persistencia
      if (avatarUrl && avatarUrl.startsWith("https://")) {
        updates.avatarUrl = avatarUrl;
      } else if (avatarUrl === null) {
        updates.avatarUrl = null;
      }

      const res = await updateMyProfileAction(updates);
      if (!res.ok) {
        setErr(res.message);
        return;
      }

      setMsg("Perfil actualizado correctamente.");
      onSaved?.({
        ...profile,
        presence,
        notifFreq,
        avatarUrl: avatarUrl,
        preferences: {
          ...profile.preferences,
          theme: theme as "system" | "light" | "dark",
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      {/* Sección Foto de Perfil */}
      <div className="space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-wide text-fg-secondary">
          Foto de Perfil
        </label>
        <div className="flex items-center gap-4">
          <Avatar
            src={preview}
            name={profile.fullName}
            initials={initialsFrom(profile.fullName)}
            size="lg"
          />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="avatar-upload"
                className="btn btn-secondary btn-sm cursor-pointer"
              >
                <Icon name="camera" size={13} />
                <span>Subir foto</span>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
              {(preview || avatarUrl) && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={saving}
                  className="btn btn-ghost btn-sm text-tops-red hover:bg-tops-red/10"
                >
                  <Icon name="trash" size={13} />
                  <span>Quitar</span>
                </button>
              )}
            </div>
            <p className="text-[11px] text-fg-muted">
              JPG, PNG o WebP hasta 2MB. Si no tenés foto, se muestran tus iniciales ({initialsFrom(profile.fullName)}).
            </p>
          </div>
        </div>
      </div>

      {/* Estado de Presencia */}
      <div className="space-y-2">
        <label htmlFor="presence-select" className="block text-xs font-semibold uppercase tracking-wide text-fg-secondary">
          Estado de Presencia
        </label>
        <select
          id="presence-select"
          value={presence}
          onChange={(e) => setPresence(e.target.value as PresenceStatus)}
          className="w-full rounded-md border border-stroke-soft bg-bg-surface px-3 py-2 text-sm text-fg-primary focus:border-tops-red outline-none"
        >
          {PRESENCE_ORDER.map((st) => (
            <option key={st} value={st}>
              {PRESENCE_LABELS[st]}
            </option>
          ))}
        </select>
      </div>

      {/* Frecuencia de Notificaciones */}
      <div className="space-y-2">
        <label htmlFor="notif-select" className="block text-xs font-semibold uppercase tracking-wide text-fg-secondary">
          Notificaciones por Correo
        </label>
        <select
          id="notif-select"
          value={notifFreq}
          onChange={(e) => setNotifFreq(e.target.value as NotifFreq)}
          className="w-full rounded-md border border-stroke-soft bg-bg-surface px-3 py-2 text-sm text-fg-primary focus:border-tops-red outline-none"
        >
          {NOTIF_ORDER.map((fq) => (
            <option key={fq} value={fq}>
              {NOTIF_FREQ_LABELS[fq]}
            </option>
          ))}
        </select>
      </div>

      {/* Tema de Interfaz */}
      <div className="space-y-2">
        <label htmlFor="theme-select" className="block text-xs font-semibold uppercase tracking-wide text-fg-secondary">
          Tema Visual
        </label>
        <select
          id="theme-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          className="w-full rounded-md border border-stroke-soft bg-bg-surface px-3 py-2 text-sm text-fg-primary focus:border-tops-red outline-none"
        >
          {THEME_ORDER.map((th) => (
            <option key={th} value={th}>
              {th === "system" ? "Automático del sistema" : th === "light" ? "Modo Claro" : "Modo Oscuro"}
            </option>
          ))}
        </select>
      </div>

      {/* Mensajes de Feedback */}
      {msg && (
        <div role="status" className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-600">
          {msg}
        </div>
      )}
      {err && (
        <div role="alert" className="rounded-md bg-tops-red/10 border border-tops-red/30 p-3 text-xs text-tops-red">
          {err}
        </div>
      )}

      {/* Botón Guardar */}
      <button
        type="submit"
        disabled={saving}
        className="btn btn-nexus w-full flex items-center justify-center gap-2"
      >
        <Icon name="check" size={14} />
        <span>{saving ? "Guardando…" : "Guardar Cambios"}</span>
      </button>
    </form>
  );
}
