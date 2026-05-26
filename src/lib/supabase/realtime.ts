"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Hook genérico para suscribirse a cambios en una tabla de Supabase.
 * Devuelve void; el caller usa el callback para refrescar router/state.
 *
 * Importante: en demo mode (sin Supabase) NO suscribe nada, returning cleanly.
 */
export function useRealtimeTable(
  table: "orders" | "notifications" | "order_services",
  onChange: (payload: {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
  }) => void,
  options: { filter?: string; enabled?: boolean } = {}
): void {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (options.enabled === false) return;
    const supabase = createClient();
    if (!supabase) return;

    const channel: RealtimeChannel = supabase
      .channel(`realtime:${table}:${options.filter ?? "all"}`)
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
  }, [table, options.filter, options.enabled]);
}
