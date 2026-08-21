"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { completePasswordReset } from "./actions";

export default function ResetForm({
  authorized,
  initialError,
}: {
  authorized: boolean;
  initialError?: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!authorized) return setError("La sesión de recuperación no es válida. Pedí un enlace nuevo.");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");

    startTransition(async () => {
      const result = await completePasswordReset({ password, confirmation: confirm });
      if (!result.ok) {
        if (result.passwordUpdated) setSuccess(true);
        setError(result.error ?? "No pudimos guardar la contraseña.");
        return;
      }
      setSuccess(true);
      router.replace("/login?reset=success");
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

      {!authorized && !error && (
        <div className="rounded-md bg-status-warning/10 text-status-warning text-sm px-3 py-2 border border-status-warning/20">
          El enlace no contiene una sesión de recuperación válida.
        </div>
      )}

      {!authorized && (
        <Link href="/auth/forgot-password" className="btn btn-secondary w-full text-center">
          Enviar un nuevo enlace
        </Link>
      )}

      {success && (
        <div className="rounded-md bg-status-success/10 text-status-success text-sm px-3 py-2 border border-status-success/20">
          Contraseña actualizada. Iniciá sesión con tu nueva contraseña.
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
        disabled={pending || !authorized || success}
      >
        {pending ? "Guardando…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
