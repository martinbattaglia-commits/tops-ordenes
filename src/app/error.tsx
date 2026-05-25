"use client";

import { useEffect } from "react";
import { Icon } from "@/components/Icon";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Punto de integración para Sentry / Logflare si se configura.
    console.error("[TOPS Órdenes] uncaught:", error);
  }, [error]);

  return (
    <div className="min-h-screen grid place-items-center bg-bg-page p-6">
      <div className="card card-pad max-w-md text-center">
        <div className="w-14 h-14 rounded-full bg-status-danger/10 text-status-danger grid place-items-center mx-auto mb-4">
          <Icon name="x" size={28} stroke={2} />
        </div>
        <h1 className="text-xl font-bold text-fg-brand mb-1">Algo no salió bien</h1>
        <p className="text-sm text-fg-secondary mb-4">
          Se produjo un error inesperado. El equipo técnico fue notificado automáticamente.
        </p>
        {error.digest && (
          <div className="text-[11px] text-fg-muted font-mono mb-4">Ref: {error.digest}</div>
        )}
        <div className="flex gap-2 justify-center">
          <button onClick={reset} className="btn btn-primary btn-sm">
            <Icon name="refresh" size={13} /> Reintentar
          </button>
          <a href="/dashboard" className="btn btn-ghost btn-sm">
            Volver al inicio
          </a>
        </div>
      </div>
    </div>
  );
}
