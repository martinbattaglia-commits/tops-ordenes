import type { FleetLastPosition, FleetLiveStatus } from "./types";

/**
 * Derivación de estado LIVE a partir de la recency del último ping.
 *
 * No persiste estado: es función pura del último timestamp conocido. La
 * distinción movimiento/detenido (por velocidad) se calibra en la fase UI,
 * una vez confirmada la unidad real que reporta el dispositivo.
 */

/**
 * Ventana de frescura del FIX GPS (recorded_at): si la última posición
 * capturada supera esto, la posición se considera vieja (no fresca).
 */
export const FLEET_OFFLINE_AFTER_MS = 5 * 60 * 1000;

/**
 * Ventana de frescura de la COMUNICACIÓN (created_at): si el dispositivo no
 * entrega nada hace más de esto, el vehículo está OFFLINE (sin contacto).
 */
export const FLEET_COMM_FRESH_MS = 5 * 60 * 1000;

export function deriveLiveStatus(
  pos: FleetLastPosition | null,
  nowMs: number
): FleetLiveStatus {
  if (!pos) return "offline";
  const age = nowMs - new Date(pos.recorded_at).getTime();
  return age <= FLEET_OFFLINE_AFTER_MS ? "online" : "offline";
}
