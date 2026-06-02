/**
 * Tipos de dominio del módulo OPERACIONES → Tracking de Flota.
 *
 * Canónicos para TODA la capa de tracking. La UI consume SOLO estos tipos
 * (view-models normalizados), nunca filas crudas de proveedores ni payloads
 * de Traccar/Teltonika/etc. Esa es la garantía del Provider Layer.
 */

export type FleetVehicleStatus = "active" | "inactive" | "maintenance";

/** Estado live derivado en tiempo real (no se persiste). */
export type FleetLiveStatus = "online" | "offline";

export interface FleetLastPosition {
  latitude: number;
  longitude: number;
  speed: number | null;
  battery: number | null;
  heading: number | null;
  recorded_at: string;
}

export interface FleetVehicleRow {
  id: string;
  name: string;
  plate: string | null;
  type: string | null;
  status: FleetVehicleStatus;
  driver_name: string | null;
  device_identifier: string | null;
  updated_at: string;
}

export interface FleetVehicle extends FleetVehicleRow {
  last_position: FleetLastPosition | null;
}

// ---- Geocercas ----------------------------------------------------------

export type GeofenceKind = "circle" | "polygon";

export interface Geofence {
  id: string;
  name: string;
  kind: GeofenceKind;
  active: boolean;
  color: string | null;
  description: string | null;
  /** Para kind='circle': centro [lng, lat] + radio en metros. */
  center: { latitude: number; longitude: number } | null;
  radius_m: number | null;
}

// ---- Eventos ------------------------------------------------------------

/**
 * Tipos de evento. Sembrados con el roadmap completo desde el día 1 (espejo del
 * enum fleet_event_type_t en 0018) para evitar migraciones/cambios de tipo
 * posteriores. Hoy solo geofence_* tiene contrato; el resto está reservado y su
 * lógica de emisión llega en fases siguientes.
 */
export type FleetEventType =
  | "geofence_enter"
  | "geofence_exit"
  | "vehicle_online"
  | "vehicle_offline"
  | "vehicle_idle"
  | "vehicle_moving"
  | "speeding";

export interface FleetEvent {
  id: number;
  vehicle_id: string;
  geofence_id: string | null;
  position_id: number | null;
  type: FleetEventType;
  recorded_at: string;
  metadata: Record<string, unknown>;
}
