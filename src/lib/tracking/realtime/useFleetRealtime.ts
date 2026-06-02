"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  FLEET_POSITIONS_TABLE,
  FLEET_REALTIME_CHANNEL,
  toLivePositionEvent,
  type FleetPositionRow,
  type LivePositionEvent,
} from "./contracts";

/**
 * Suscripción Realtime a los INSERT de fleet_positions (CDC de Supabase).
 *
 * Mismo patrón que src/lib/supabase/realtime.ts (canal + postgres_changes +
 * removeChannel en cleanup), especializado para el tracking. En demo mode (sin
 * Supabase) no suscribe nada y reporta "disabled" — la UI sigue con el snapshot
 * SSR, sin romperse.
 */
export type FleetRealtimeStatus = "disabled" | "connecting" | "live" | "error";

export function useFleetRealtime(
  onPosition: (event: LivePositionEvent) => void
): FleetRealtimeStatus {
  const cbRef = useRef(onPosition);
  cbRef.current = onPosition;

  const [status, setStatus] = useState<FleetRealtimeStatus>("connecting");

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setStatus("disabled");
      return;
    }

    const channel: RealtimeChannel = supabase
      .channel(FLEET_REALTIME_CHANNEL)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: FLEET_POSITIONS_TABLE },
        (payload) => {
          cbRef.current(toLivePositionEvent(payload.new as FleetPositionRow));
        }
      )
      .subscribe((channelStatus) => {
        if (channelStatus === "SUBSCRIBED") setStatus("live");
        else if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT")
          setStatus("error");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return status;
}
