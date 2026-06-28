"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

interface Props {
  poId: string;
  invoiceId: string;
}

/**
 * Dispara el inicio de conciliación contra el endpoint POST /api/compras/conciliar/{poId}
 * usando fetch con cuerpo JSON (mismo patrón que ReconActions), en lugar de un POST de
 * formulario nativo — que enviaba el cuerpo como x-www-form-urlencoded y navegaba a la API
 * mostrando el JSON crudo. En éxito, refresca el server component para renderizar el detalle.
 */
export function IniciarReconButton({ poId, invoiceId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/compras/conciliar/${poId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const json = await r.json();
      if (!r.ok) {
        setError(json.error ?? "No se pudo iniciar la conciliación.");
      } else {
        router.refresh();
      }
    } catch {
      setError("Error de red. Verificá tu conexión e intentá nuevamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/30 p-3 text-xs text-[var(--status-danger)] flex gap-2">
          <Icon name="x" size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        disabled={loading}
        onClick={start}
        className="btn btn-primary btn-sm disabled:opacity-50"
      >
        <Icon name="check" size={14} /> {loading ? "Iniciando…" : "Iniciar conciliación"}
      </button>
    </div>
  );
}
