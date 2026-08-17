import { env } from "@/lib/env";

/**
 * Mapa de dispositivos hardware (piloto FMC130).
 *
 * El forward de Traccar Server trae el IMEI del equipo. Nexus resuelve el
 * vehículo por `fleet_vehicles.device_identifier`, que NO es el IMEI: se usa un
 * alias estable (p. ej. "FMC130-MB-01"). Este módulo traduce IMEI → alias
 * interno leyendo la env `TRACCAR_DEVICE_MAP` (JSON). Sin migración ni tabla:
 * mapping por configuración, reversible.
 *
 * Formato de TRACCAR_DEVICE_MAP:
 *   { "<IMEI>": { "device_identifier": "FMC130-MB-01", "vehicle_code": "CAMION_01" }, ... }
 *
 * Futuro (con aprobación): reemplazar por tabla `tracking_device_mappings`.
 */

export interface DeviceMapping {
  device_identifier: string;
  vehicle_code: string | null;
}

let cache: { raw: string; map: Map<string, DeviceMapping> } | null = null;

function buildMap(raw: string): Map<string, DeviceMapping> {
  const map = new Map<string, DeviceMapping>();
  if (!raw) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSON inválido → mapa vacío. El endpoint responderá 422 (no rompe prod).
    return map;
  }
  if (!parsed || typeof parsed !== "object") return map;
  for (const [imei, val] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = (val ?? {}) as { device_identifier?: unknown; vehicle_code?: unknown };
    const id = typeof entry.device_identifier === "string" ? entry.device_identifier.trim() : "";
    if (!imei.trim() || !id) continue; // entradas incompletas se ignoran
    map.set(imei.trim(), {
      device_identifier: id,
      vehicle_code: typeof entry.vehicle_code === "string" ? entry.vehicle_code.trim() : null,
    });
  }
  return map;
}

function currentMap(): Map<string, DeviceMapping> {
  const raw = env.tracking.deviceMapRaw;
  if (!cache || cache.raw !== raw) cache = { raw, map: buildMap(raw) };
  return cache.map;
}

/** Resuelve IMEI → mapping interno, o null si no está mapeado. */
export function resolveDeviceMapping(imei: string): DeviceMapping | null {
  return currentMap().get(imei.trim()) ?? null;
}

/** Cantidad de dispositivos mapeados (diagnóstico; no expone IMEIs). */
export function deviceMapSize(): number {
  return currentMap().size;
}
