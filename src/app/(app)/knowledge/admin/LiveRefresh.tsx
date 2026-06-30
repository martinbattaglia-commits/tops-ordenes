"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useRealtimeTable } from "@/lib/supabase/realtime";

/**
 * F0.5.2 / E2.3 — Refresco del panel (D-6, modelo híbrido).
 *
 * · KPIs generales → POLLING: refetch del server component cada `pollMs` (default 45s).
 * · Alertas críticas → REALTIME: suscripción a `knowledge_events` filtrada a `status=dead`
 *   (la tabla ya está en la publicación `supabase_realtime` desde E1; no se toca el Worker).
 *
 * SOLO LECTURA: el realtime y el polling sólo disparan `router.refresh()`; nunca mutan.
 */
export default function LiveRefresh({ pollMs = 45_000 }: { pollMs?: number }) {
  const router = useRouter();
  const [criticalSeq, setCriticalSeq] = useState<number | null>(null);
  const [lastTickIso, setLastTickIso] = useState<string | null>(null);

  // Polling de KPIs generales.
  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setLastTickIso(new Date().toISOString());
    }, pollMs);
    return () => clearInterval(id);
  }, [router, pollMs]);

  // Realtime: alerta crítica al aparecer un evento dead.
  const onDead = useCallback(
    (p: { new: Record<string, unknown> | null }) => {
      const seq = p.new?.seq;
      setCriticalSeq(typeof seq === "number" ? seq : -1);
      router.refresh();
    },
    [router],
  );
  useRealtimeTable("knowledge_events", onDead, { filter: "status=eq.dead" });

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Monitoreo en vivo · polling {Math.round(pollMs / 1000)}s + realtime de dead-letter
      </div>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="btn btn-ghost btn-sm"
        aria-label="Refrescar ahora"
      >
        <Icon name="refresh" size={12} /> Refrescar
      </button>

      {criticalSeq !== null && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 shadow-lg dark:text-red-300"
        >
          <Icon name="bolt" size={16} />
          <span>
            Nuevo evento en <b>dead-letter</b>
            {criticalSeq > 0 ? ` (seq ${criticalSeq})` : ""}. Revisá la sección Dead-letter.
          </span>
          <button type="button" onClick={() => setCriticalSeq(null)} aria-label="Descartar alerta">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* lastTickIso se mantiene para forzar re-render coherente del estado de polling */}
      <span className="sr-only">{lastTickIso ?? ""}</span>
    </div>
  );
}
