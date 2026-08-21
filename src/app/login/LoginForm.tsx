"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, sendMagicLink } from "./actions";
import { safeAuthNext } from "@/lib/supabase/auth-recovery-shared";

export default function LoginForm({
  redirectTo,
  initialError,
  initialInfo,
}: {
  redirectTo?: string;
  initialError?: string;
  initialInfo?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [info, setInfo] = useState<string | null>(initialInfo ?? null);
  const [loading, setLoading] = useState(false);
  const [granted, setGranted] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [passError, setPassError] = useState(false);
  const safeRedirectTo = safeAuthNext(redirectTo);

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    let ok = true;
    if (!isValidEmail(email.trim())) {
      setEmailError(true);
      ok = false;
    }
    if (!password) {
      setPassError(true);
      ok = false;
    }
    if (!ok) return;

    setLoading(true);
    const result = await signIn({
      email: email.trim(),
      password,
      redirectTo: safeRedirectTo,
    });

    if (!result.ok) {
      setLoading(false);
      setError(result.error ?? "Credenciales inválidas. Verificá tu correo y contraseña.");
      return;
    }

    setLoading(false);
    setGranted(true);
    router.replace(result.redirect ?? safeRedirectTo);
    router.refresh();
  };

  const handleMagic = async () => {
    setError(null);
    setInfo(null);
    if (!isValidEmail(email.trim())) {
      setEmailError(true);
      setError("Ingresá tu email corporativo primero.");
      return;
    }

    setLoading(true);
    const result = await sendMagicLink({
      email: email.trim(),
      redirectTo: safeRedirectTo,
    });
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? "No pudimos procesar la solicitud.");
      return;
    }
    setInfo("Te enviamos un link de acceso a tu casilla. Revisá la bandeja de entrada.");
  };

  return (
    <form id="loginForm" onSubmit={handleLogin} autoComplete="on" noValidate>
      <div className="tn-f-head tn-reveal" style={{ animationDelay: ".22s" }}>
        <div className="tn-ey">Acceso corporativo</div>
        <h2>Iniciá sesión</h2>
        <div className="tn-fsub">
          <b>TOPS NEXUS</b> Operating System · Ingresá con tu email corporativo
        </div>
      </div>

      {/* Email */}
      <div className="tn-field tn-reveal" style={{ animationDelay: ".3s" }}>
        <div className="tn-lab">
          <span className="tn-name">
            Email <span className="tn-req">*</span>
          </span>
        </div>
        <div className={`tn-inwrap${emailError ? " tn-err" : ""}`}>
          <span className="tn-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-10 6L2 7" />
            </svg>
          </span>
          <input
            type="email"
            id="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            placeholder="nombre@logisticatops.com"
            value={email}
            required
            onChange={(e) => {
              setEmail(e.target.value);
              if (isValidEmail(e.target.value)) setEmailError(false);
            }}
          />
        </div>
        <div className={`tn-ferr${emailError ? " tn-on" : ""}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>Ingresá un email válido.</span>
        </div>
      </div>

      {/* Password */}
      <div className="tn-field tn-reveal" style={{ animationDelay: ".36s" }}>
        <div className="tn-lab">
          <span className="tn-name">
            Contraseña <span className="tn-req">*</span>
          </span>
          <span style={{ display: "flex", gap: "14px", alignItems: "center" }}>
            <a href="/auth/forgot-password">¿Olvidaste tu contraseña?</a>
            <button type="button" className="tn-magic" onClick={handleMagic} disabled={loading}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" />
              </svg>
              Magic link
            </button>
          </span>
        </div>
        <div className={`tn-inwrap${passError ? " tn-err" : ""}`}>
          <span className="tn-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <input
            type={showPassword ? "text" : "password"}
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            required
            minLength={6}
            onChange={(e) => {
              setPassword(e.target.value);
              if (e.target.value) setPassError(false);
            }}
          />
          <button
            type="button"
            className="tn-eye-toggle"
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            onClick={() => setShowPassword((s) => !s)}
          >
            {showPassword ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a16 16 0 0 1-2.3 3.2M6.6 6.6A16 16 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 4.4-1.1" />
                <path d="m2 2 20 20" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        <div className={`tn-ferr${passError ? " tn-on" : ""}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>Ingresá tu contraseña.</span>
        </div>
      </div>

      {/* Alertas de autenticación */}
      {error && (
        <div className="tn-alert tn-danger" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>{error}</span>
        </div>
      )}
      {info && (
        <div className="tn-alert tn-info" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
          </svg>
          <span>{info}</span>
        </div>
      )}

      <button
        type="submit"
        className={`tn-btn tn-btn-primary tn-reveal${granted ? " tn-ok-state" : ""}`}
        style={{ animationDelay: ".42s" }}
        disabled={loading || granted}
      >
        <span className="tn-lbltxt">
          {granted ? "Acceso concedido" : loading ? "Verificando credenciales" : "Ingresar al sistema"}
        </span>
        <span className="tn-arr">
          {granted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : loading ? (
            <span className="tn-spinner" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </span>
      </button>

      <div className="tn-terms tn-reveal" style={{ animationDelay: ".46s" }}>
        Al ingresar aceptás la <a href="#">política de privacidad</a> y los{" "}
        <a href="#">términos de uso</a> de Logística TOPS.
      </div>

      <div className="tn-f-foot tn-reveal" style={{ animationDelay: ".58s" }}>
        <div className="tn-help">
          ¿Problemas para ingresar?{" "}
          <a href="mailto:soporte@logisticatops.com">soporte@logisticatops.com</a>
        </div>
        <div className="tn-secure">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          Conexión cifrada
        </div>
      </div>
    </form>
  );
}
