import type { NormalizedPosition } from "../provider/types";
import type { FleetEventType } from "../types";

/**
 * Contratos del Tracking Engine.
 *
 * El Engine orquesta: resolver dispositivo→vehículo, persistir la posición,
 * (en fase posterior) evaluar transiciones de geocerca y emitir eventos. No
 * conoce HTTP ni el formato del proveedor; recibe NormalizedPosition.
 *
 * La persistencia se inyecta como PORT (hexagonal) → el Engine es puro y
 * testeable; el adaptador concreto (Supabase service_role) vive aparte.
 */

export interface VehicleRef {
  id: string;
}

/** Borrador de evento que el Engine puede emitir tras evaluar geocercas. */
export interface FleetEventDraft {
  vehicleId: string;
  geofenceId: string | null;
  positionId: number | null;
  type: FleetEventType;
  recordedAt: string;
  metadata: Record<string, unknown>;
}

/** Puerto de persistencia. Implementado por el adaptador Supabase. */
export interface FleetPersistencePort {
  resolveVehicleByDevice(device: string): Promise<VehicleRef | null>;
  insertPosition(
    vehicleId: string,
    pos: NormalizedPosition
  ): Promise<{ positionId: number }>;
  touchVehicle(vehicleId: string): Promise<void>;
  // insertEvents(events): reservado para la fase de eventos (geofencing).
}

export type IngestOutcome =
  | { ok: true; vehicleId: string; positionId: number; events: number }
  | { ok: false; reason: "unknown-device"; device: string }
  | { ok: false; reason: "persist-error"; detail: string };

export interface TrackingEngine {
  ingest(pos: NormalizedPosition): Promise<IngestOutcome>;
}
