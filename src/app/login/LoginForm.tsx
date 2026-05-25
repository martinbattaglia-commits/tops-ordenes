"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { signIn, sendMagicLink } from "./actions";

export default function LoginForm({
  redirectTo,
  initialError,
}: {
  redirectTo?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await signIn({ email, password, redirectTo: redirectTo ?? "/dashboard" });
      if (!res.ok) {
        setError(res.error ?? "No pudimos validar las credenciales.");
        return;
      }
      router.replace(res.redirect ?? "/dashboard");
      router.refresh();
    });
  };

  const handleMagic = () => {
    setError(null);
    setInfo(null);
    if (!email) {
      setError("Ingresá tu email corporativo primero.");
      return;
    }
    startTransition(async () => {
      const res = await sendMagicLink({ email, redirectTo: redirectTo ?? "/dashboard" });
      if (!res.ok) {
        setError(res.error ?? "No pudimos enviar el link.");
        return;
      }
      setInfo("Te enviamos un link de acceso a tu casilla. Revisá la bandeja de entrada.");
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
      <div>
        <label htmlFor="email" className="field-label">
          Email corporativo
          <span className="req">*</span>
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

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="field-label">
            Contraseña
            <span className="req">*</span>
          </label>
          <button
            type="button"
            className="text-xs text-fg-link font-semibold hover:underline"
            onClick={handleMagic}
            disabled={pending}
          >
            Enviarme link de acceso
          </button>
        </div>
        <div className="relative">
          <Icon
            name="lock"
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
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

      <button type="submit" className="btn btn-danger btn-lg w-full" disabled={pending}>
        {pending ? "Ingresando…" : "Ingresar al panel"}
        <Icon name="arrow-right" size={16} stroke={2.2} />
      </button>

      <p className="text-xs text-fg-muted text-center pt-2">
        Al ingresar aceptás la{" "}
        <a href="#" className="text-fg-link">
          política de privacidad
        </a>{" "}
        y los{" "}
        <a href="#" className="text-fg-link">
          términos de uso
        </a>{" "}
        de Logística TOPS.
      </p>
    </form>
  );
}
