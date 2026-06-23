"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/client";
import { env } from "@/lib/env";

export default function ResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Estado del link de recuperación: mientras `checking` resolvemos si la URL
  // trae una sesión válida; `ready` indica que ya hay sesión para poder guardar.
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  // El cliente de browser (@supabase/ssr) detecta automáticamente el token que
  // Supabase deja en la URL al volver del email de recuperación —ya sea `?code=`
  // (PKCE) o `#access_token=...` (hash)— y establece la sesión sincronizándola a
  // cookies. Esperamos ese evento antes de habilitar el guardado; sin sesión,
  // updateUser fallaría con "Auth session missing!".
  useEffect(() => {
    if (env.app.demoMode) {
      setReady(true);
      setChecking(false);
      return;
    }
    if (!supabase) {
      setError("Supabase no está configurado.");
      setChecking(false);
      return;
    }

    let active = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) {
        setReady(true);
        setChecking(false);
      }
    });

    // Chequeo inicial por si la sesión ya quedó establecida (p. ej. el callback
    // ya canjeó el code) antes de montar este componente.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) setReady(true);
      setChecking(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Mínimo 8 caracteres.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");

    startTransition(async () => {
      if (env.app.demoMode) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      if (!supabase) {
        setError("Supabase no está configurado.");
        return;
      }

      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(updErr.message);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
      <div>
        <label className="field-label">
          Nueva contraseña<span className="req">*</span>
        </label>
        <div className="relative">
          <Icon
            name="lock"
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input pl-10"
          />
        </div>
      </div>
      <div>
        <label className="field-label">
          Repetí la contraseña<span className="req">*</span>
        </label>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="input"
        />
      </div>

      {!checking && !ready && !error && (
        <div className="rounded-md bg-status-warning/10 text-status-warning text-sm px-3 py-2 border border-status-warning/20">
          El link de recuperación es inválido o expiró. Pedí uno nuevo desde
          «Olvidé mi contraseña».
        </div>
      )}

      {error && (
        <div className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={pending || checking || !ready}
      >
        {pending ? "Guardando…" : checking ? "Validando link…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
