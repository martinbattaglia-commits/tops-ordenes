import { createClient } from "@/lib/supabase/server";
import type { FleetVehicle, FleetVehicleRow, FleetLastPosition } from "./types";

/**
 * Data layer (lectura) del módulo OPERACIONES → Tracking de Flota.
 *
 * Lista vehículos + última posición conocida. La capa de mapa (fase UI) y el
 * realtime consumen estos mismos tipos de dominio (ver ./types).
 *
 * La columna geoespacial `geom` (PostGIS) es generada en la DB a partir de
 * latitude/longitude; las lecturas siguen usando lat/lng planos (lo que el
 * mapa necesita). Las consultas por proximidad/geocerca a escala usan el
 * índice GIST sobre `geom` desde el Engine, no desde acá.
 *
 * Degradación: si las tablas (migraciones 0016–0019) todavía no están
 * aplicadas, la query devuelve error y la página lo muestra con
 * <ModuleUnavailable> en vez de romper el shell.
 */

// Re-exports para compatibilidad con los consumidores existentes.
export type {
  FleetVehicle,
  FleetVehicleRow,
  FleetLastPosition,
  FleetVehicleStatus,
  FleetLiveStatus,
} from "./types";
export { deriveLiveStatus, FLEET_OFFLINE_AFTER_MS } from "./status";

export type FleetListResult =
  | { ok: true; vehicles: FleetVehicle[] }
  | { ok: false; error: string };

/**
 * Lista la flota con la última posición de cada vehículo.
 * En demo mode (sin Supabase) devuelve lista vacía (ok), no error.
 */
export async function listFleet(): Promise<FleetListResult> {
  const supabase = createClient();
  if (!supabase) return { ok: true, vehicles: [] };

  const { data: vehicleData, error } = await supabase
    .from("fleet_vehicles")
    .select("id,name,plate,type,status,driver_name,device_identifier,updated_at")
    .order("name", { ascending: true });

  if (error) return { ok: false, error: error.message };

  const rows = (vehicleData ?? []) as FleetVehicleRow[];
  if (rows.length === 0) return { ok: true, vehicles: [] };

  // Última posición por vehículo: traemos ordenado desc y nos quedamos con la
  // primera de cada vehicle_id (el índice fleet_positions_vehicle_recorded_idx
  // hace esto barato).
  const { data: positionData } = await supabase
    .from("fleet_positions")
    .select("vehicle_id,latitude,longitude,speed,battery,heading,recorded_at")
    .in("vehicle_id", rows.map((v) => v.id))
    .order("recorded_at", { ascending: false });

  const latest = new Map<string, FleetLastPosition>();
  for (const p of positionData ?? []) {
    if (!latest.has(p.vehicle_id)) {
      latest.set(p.vehicle_id, {
        latitude: p.latitude,
        longitude: p.longitude,
        speed: p.speed,
        battery: p.battery,
        heading: p.heading,
        recorded_at: p.recorded_at,
      });
    }
  }

  return {
    ok: true,
    vehicles: rows.map((v) => ({ ...v, last_position: latest.get(v.id) ?? null })),
  };
}
