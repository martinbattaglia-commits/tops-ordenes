/**
 * Contratos de Realtime del tracking.
 *
 * El módulo se actualiza solo (sin polling) suscribiendo el cliente a los
 * INSERT de fleet_positions vía Supabase Realtime (CDC de Postgres). Esta capa
 * define SOLO los contratos tipados; el wiring del canal a los marcadores del
 * mapa se implementa en la fase UI (Mapbox), no ahora.
 *
 * Requisito DB: fleet_positions debe estar en la publicación supabase_realtime
 * (lo hace 0016_tracking_foundation de forma idempotente).
 */

import type { FleetLiveStatus } from "../types";

export const FLEET_POSITIONS_TABLE = "fleet_positions" as const;
export const FLEET_REALTIME_CHANNEL = "fleet-positions" as const;

/** Fila cruda tal como la entrega Supabase Realtime (postgres_changes.new). */
export interface FleetPositionRow {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  battery: number | null;
  heading: number | null;
  recorded_at: string;
}

/** Evento normalizado que consume la UI (un ping en vivo). */
export interface LivePositionEvent {
  vehicleId: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  battery: number | null;
  heading: number | null;
  recordedAt: string;
}

/** Normaliza la fila CDC al view-model de la UI. */
export function toLivePositionEvent(row: FleetPositionRow): LivePositionEvent {
  return {
    vehicleId: row.vehicle_id,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKmh: row.speed,
    battery: row.battery,
    heading: row.heading,
    recordedAt: row.recorded_at,
  };
}

/** Descriptor de la suscripción Realtime (consumido por la UI en fase visual). */
export interface FleetRealtimeSubscription {
  channel: typeof FLEET_REALTIME_CHANNEL;
  schema: "public";
  table: typeof FLEET_POSITIONS_TABLE;
  event: "INSERT";
}

export const FLEET_REALTIME_SUBSCRIPTION: FleetRealtimeSubscription = {
  channel: FLEET_REALTIME_CHANNEL,
  schema: "public",
  table: FLEET_POSITIONS_TABLE,
  event: "INSERT",
};

/** Re-export de conveniencia para los consumidores de la UI. */
export type { FleetLiveStatus };
