"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/client";
import { env } from "@/lib/env";

/**
 * Login form — patrón Supabase Auth client-side estándar.
 * El browser ejecuta signInWithPassword directamente → request visible en
 * DevTools (POST /auth/v1/token) → cookies seteadas automáticamente por
 * @supabase/ssr → middleware del server las lee en la siguiente navegación.
 *
 * NO usa Server Actions porque ocultan el flujo del lado del browser y
 * dificultan debug.
 */
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
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (env.app.demoMode) {
      setError(
        "La app está corriendo en DEMO MODE (NEXT_PUBLIC_DEMO_MODE=1). En este modo no hay autenticación real. Para producción, seteá NEXT_PUBLIC_DEMO_MODE=0 + las keys de Supabase en Netlify."
      );
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setError(
        "Supabase no está configurado. Falta NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY en las env vars de Netlify."
      );
      return;
    }

    setLoading(true);
    // Log claro para debug en DevTools console
    // eslint-disable-next-line no-console
    console.log("[TOPS] login start", { email });

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // eslint-disable-next-line no-console
    console.log("[TOPS] login response", { user: data?.user?.id ?? null, error: authError });

    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }
    if (!data?.session) {
      setError("La autenticación no devolvió sesión. Revisá la configuración del proyecto.");
      return;
    }

    router.replace(redirectTo ?? "/dashboard");
    router.refresh();
  };

  const handleMagic = async () => {
    setError(null);
    setInfo(null);
    if (!email) {
      setError("Ingresá tu email corporativo primero.");
      return;
    }

    if (env.app.demoMode) {
      setError("Demo mode: los magic links no se envían.");
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setError("Supabase no está configurado.");
      return;
    }

    setLoading(true);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${env.app.url}/api/auth/callback?next=${redirectTo ?? "/dashboard"}`,
      },
    });
    setLoading(false);

    if (otpError) {
      setError(otpError.message);
      return;
    }
    setInfo("Te enviamos un link de acceso a tu casilla. Revisá la bandeja de entrada.");
  };

  return (
    <form onSubmit={handleLogin} className="space-y-4" autoComplete="on" noValidate>
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
            name="email"
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
            Contraseña<span className="req">*</span>
          </label>
          <div className="flex items-center gap-3 text-xs">
            <a
              href="/auth/forgot-password"
              className="text-fg-link font-semibold hover:underline"
            >
              ¿Olvidaste tu contraseña?
            </a>
            <button
              type="button"
              className="text-fg-link font-semibold hover:underline"
              onClick={handleMagic}
              disabled={loading}
            >
              Magic link
            </button>
          </div>
        </div>
        <div className="relative">
          <Icon
            name="lock"
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="input pl-10"
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20"
        >
          {error}
        </div>
      )}
      {info && (
        <div
          role="status"
          className="rounded-md bg-status-info/10 text-status-info text-sm px-3 py-2 border border-status-info/20"
        >
          {info}
        </div>
      )}

      <button
        type="submit"
        className="btn btn-danger btn-lg w-full"
        disabled={loading}
      >
        {loading ? "Ingresando…" : "Ingresar al panel"}
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
