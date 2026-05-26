"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { sendPasswordResetLink } from "./actions";

export default function ForgotForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await sendPasswordResetLink({ email });
      if (!res.ok) {
        setError(res.error ?? "No pudimos enviar el link.");
        return;
      }
      setInfo(
        "Te enviamos un email con el link de recuperación. Revisá tu bandeja (y la carpeta de spam)."
      );
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="field-label">
          Email corporativo<span className="req">*</span>
        </label>
        <div className="relative">
          <Icon
            name="mail"
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nombre@logisticatops.com"
            className="input pl-10"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-md bg-status-info/10 text-status-info text-sm px-3 py-2 border border-status-info/20">
          {info}
        </div>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Enviando…" : "Enviar link de recuperación"}
      </button>
    </form>
  );
}
