import type {
  ParamGetter,
  ProviderParseResult,
  TrackingProvider,
} from "./types";

/**
 * Proveedor: Traccar Client (iPhone/Android). Soporta DOS formatos del MISMO
 * cliente, en simultáneo y sin romper compatibilidad:
 *
 *  1. OsmAnd legacy (query-string / form-urlencoded):
 *       id, lat|latitude, lon|longitude, speed(NUDOS), batt|battery(0..100),
 *       bearing|heading, accuracy|hdop, timestamp(epoch seg | ISO)
 *
 *  2. Traccar Client MODERNO (≥ v9.0.0, body JSON; el route handler lo aplana):
 *       { "device_id": "...",
 *         "location": {
 *           "timestamp": "ISO-8601",
 *           "coords": { "latitude", "longitude", "speed"(M/S), "heading", "accuracy" },
 *           "battery": { "level": 0..1 }, "is_moving": bool, "odometer": ... } }
 *     Tras el aplanado del route quedan las claves planas:
 *       device_id, latitude, longitude, speed, heading, accuracy, level, timestamp
 *
 * Normalización (ÚNICO punto del sistema que conoce las unidades crudas):
 *  · device:    legacy `id` · moderno `device_id` (alias `deviceid`).
 *  · velocidad: legacy = NUDOS → km/h (×1.852); moderno = M/S → km/h (×3.6).
 *               Se discrimina por marcadores exclusivos del cliente moderno
 *               (device_id / level / is_moving / odometer). speed < 0 (no
 *               disponible en el cliente moderno) → null.
 *  · batería:   legacy = batt|battery 0..100; moderno = level 0..1 → ×100.
 *  · timestamp: epoch(seg) o ISO → ISO-8601.
 */

const KNOTS_TO_KMH = 1.852;
const MS_TO_KMH = 3.6;

function num(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseRecordedAt(ts: string | null): string {
  if (ts && /^\d+$/.test(ts)) {
    return new Date(Number(ts) * 1000).toISOString();
  }
  if (ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

export const traccarProvider: TrackingProvider = {
  id: "traccar",
  label: "Traccar Client (OsmAnd + JSON v9)",

  parse(get: ParamGetter): ProviderParseResult {
    // Identificador del dispositivo: legacy `id`, moderno `device_id`/`deviceid`.
    const device = get("id") ?? get("device_id") ?? get("deviceid");
    const latitude = num(get("lat") ?? get("latitude"));
    const longitude = num(get("lon") ?? get("longitude"));

    if (!device || latitude === null || longitude === null) {
      return {
        ok: false,
        reason: "missing-fields",
        detail: "id/device_id, lat y lon son obligatorios",
      };
    }

    // ¿Payload del cliente moderno? Marcadores exclusivos del formato ≥ v9.
    const isModern =
      get("device_id") !== null ||
      get("level") !== null ||
      get("is_moving") !== null ||
      get("odometer") !== null;

    // Velocidad: moderno en m/s, legacy en nudos. <0 = no disponible → null.
    const speedRaw = num(get("speed"));
    const speedKmh =
      speedRaw === null || speedRaw < 0
        ? null
        : speedRaw * (isModern ? MS_TO_KMH : KNOTS_TO_KMH);

    // Batería: legacy batt/battery (0..100); moderno level (0..1) → 0..100.
    const battLegacy = num(get("batt") ?? get("battery"));
    const battLevel = num(get("level"));
    const battery =
      battLegacy !== null
        ? Math.round(battLegacy)
        : battLevel !== null
          ? Math.round(battLevel * 100)
          : null;

    return {
      ok: true,
      position: {
        device,
        latitude,
        longitude,
        speedKmh,
        battery,
        heading: num(get("bearing") ?? get("heading")),
        accuracy: num(get("accuracy") ?? get("hdop")),
        recordedAt: parseRecordedAt(get("timestamp")),
      },
    };
  },
};
