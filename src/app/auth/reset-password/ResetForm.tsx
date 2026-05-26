"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { updatePassword } from "./actions";

export default function ResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Mínimo 8 caracteres.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    startTransition(async () => {
      const res = await updatePassword({ password });
      if (!res.ok) {
        setError(res.error ?? "No pudimos actualizar la contraseña.");
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

      {error && (
        <div className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
          {error}
        </div>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Guardando…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
