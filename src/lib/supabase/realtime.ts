"use client";

import { useEffect, useId, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Hook genérico para suscribirse a cambios en una tabla de Supabase.
 * Devuelve void; el caller usa el callback para refrescar router/state.
 *
 * Importante: en demo mode (sin Supabase) NO suscribe nada, returning cleanly.
 *
 * DEFECT-1 (piloto F3): el nombre del canal debe ser ÚNICO POR INSTANCIA del hook.
 * Antes era determinístico por tabla (`realtime:${table}:all`); dos componentes
 * suscritos a la misma tabla (p.ej. NotificationsBell del layout + NotificationCenter,
 * o dos ThreadView sobre connect_messages) colisionaban: el 2º `.on('postgres_changes')`
 * se agregaba DESPUÉS del `.subscribe()` del 1º → "cannot add postgres_changes callbacks
 * ... after subscribe()" → excepción uncaught → error boundary. El sufijo único (useId)
 * da a cada instancia su propio canal + cleanup, sin listeners duplicados.
 */
export function useRealtimeTable(
  table: "orders" | "notifications" | "order_services" | "knowledge_events" | "connect_messages",
  onChange: (payload: {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
  }) => void,
  options: { filter?: string; enabled?: boolean } = {}
): void {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  // Identificador estable y único por instancia del hook (SSR-safe) → canal único.
  const instanceId = useId();

  useEffect(() => {
    if (options.enabled === false) return;
    const supabase = createClient();
    if (!supabase) return;

    const channel: RealtimeChannel = supabase
      .channel(`realtime:${table}:${options.filter ?? "all"}:${instanceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: options.filter,
        },
        (payload) => {
          cbRef.current({
            eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
            new: (payload.new as Record<string, unknown>) ?? null,
            old: (payload.old as Record<string, unknown>) ?? null,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, options.filter, options.enabled, instanceId]);
}
