import type { FleetLastPosition, FleetLiveStatus } from "./types";

/**
 * Derivación de estado LIVE a partir de la recency del último ping.
 *
 * No persiste estado: es función pura del último timestamp conocido. La
 * distinción movimiento/detenido (por velocidad) se calibra en la fase UI,
 * una vez confirmada la unidad real que reporta el dispositivo.
 */

/** Ventana de inactividad tras la cual un vehículo se considera OFFLINE. */
export const FLEET_OFFLINE_AFTER_MS = 5 * 60 * 1000;

export function deriveLiveStatus(
  pos: FleetLastPosition | null,
  nowMs: number
): FleetLiveStatus {
  if (!pos) return "offline";
  const age = nowMs - new Date(pos.recorded_at).getTime();
  return age <= FLEET_OFFLINE_AFTER_MS ? "online" : "offline";
}
