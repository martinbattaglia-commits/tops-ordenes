import type { NormalizedPosition } from "../provider/types";
import type {
  FleetPersistencePort,
  IngestOutcome,
  TrackingEngine,
} from "./types";

/**
 * Tracking Engine.
 *
 * Pipeline de ingesta: Provider (ya parseó) → Engine → Persistence → Realtime.
 *  1. Resuelve device → vehículo (desconocido = outcome tipado, no excepción).
 *  2. Persiste la posición (geom se computa en la DB; el Engine ignora PostGIS).
 *  3. Toca updated_at del vehículo (última comunicación).
 *  4. (Fase eventos) evaluaría geocercas y emitiría fleet_events.
 *
 * Realtime: el INSERT en fleet_positions dispara el broadcast CDC de Supabase
 * Realtime automáticamente; el Engine no publica nada a mano.
 */
export function createTrackingEngine(
  persistence: FleetPersistencePort
): TrackingEngine {
  return {
    async ingest(pos: NormalizedPosition): Promise<IngestOutcome> {
      try {
        const vehicle = await persistence.resolveVehicleByDevice(pos.device);
        if (!vehicle) {
          return { ok: false, reason: "unknown-device", device: pos.device };
        }

        const { positionId } = await persistence.insertPosition(vehicle.id, pos);
        await persistence.touchVehicle(vehicle.id);

        // Fase eventos: aquí se evaluarán geocercas y se insertarán eventos.
        return { ok: true, vehicleId: vehicle.id, positionId, events: 0 };
      } catch (err) {
        return {
          ok: false,
          reason: "persist-error",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export type {
  FleetPersistencePort,
  IngestOutcome,
  TrackingEngine,
  FleetEventDraft,
  VehicleRef,
} from "./types";
