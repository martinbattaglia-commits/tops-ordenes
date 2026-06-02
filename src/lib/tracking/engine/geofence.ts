import type { Geofence } from "../types";
import type { NormalizedPosition } from "../provider/types";
import type { FleetEventDraft } from "./types";

/**
 * Contrato de evaluación de geocercas (ENTER / EXIT).
 *
 * ⚠️ Esta fase entrega SOLO el contrato + la primitiva geométrica pura. El
 * cableado real (mantener el último estado dentro/fuera por vehículo, comparar
 * contra el ping anterior y emitir eventos) se implementa en la FASE DE
 * EVENTOS, junto con la persistencia de fleet_events. Acá no se llama todavía
 * desde el Engine.
 *
 * Nota: para CIRCLE se evalúa en el código (Haversine) cuando se necesita una
 * verificación rápida sin round-trip a PostGIS; la verdad geoespacial a escala
 * (POLYGON, ST_Contains/ST_DWithin) la resuelve la base con el índice GIST.
 */

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distancia Haversine en metros entre dos puntos lat/lng. */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** ¿La posición cae dentro de una geocerca circular? (polygon → vía PostGIS). */
export function isInsideCircle(
  pos: Pick<NormalizedPosition, "latitude" | "longitude">,
  fence: Geofence
): boolean {
  if (fence.kind !== "circle" || !fence.center || fence.radius_m == null) {
    return false;
  }
  const d = haversineMeters(
    pos.latitude,
    pos.longitude,
    fence.center.latitude,
    fence.center.longitude
  );
  return d <= fence.radius_m;
}

/**
 * Contrato de transición. Implementación diferida a la fase de eventos.
 * Firma estable para que el Engine y los tests puedan depender de ella ya.
 */
export function evaluateGeofenceTransitions(_input: {
  previous: NormalizedPosition | null;
  current: NormalizedPosition;
  fences: Geofence[];
  positionId: number | null;
  vehicleId: string;
}): FleetEventDraft[] {
  // TODO(fase-eventos): comparar membership previo vs actual por geocerca y
  // emitir geofence_enter / geofence_exit. Hoy no se emiten eventos.
  return [];
}
