import type {
  ParamGetter,
  ProviderParseResult,
  TrackingProvider,
} from "./types";

/**
 * Proveedor inicial: Traccar Client (iPhone/Android) en protocolo OsmAnd.
 *
 * El cliente envía (GET o POST form-urlencoded) los parámetros:
 *   id, lat, lon, speed, bearing, altitude, accuracy, batt, timestamp
 *
 * Notas de normalización:
 *  · speed: el protocolo OsmAnd reporta velocidad en NUDOS → se convierte a
 *    km/h (1 nudo = 1.852 km/h). Si tu config envía otra unidad, ajustar acá:
 *    es el único punto del sistema que conoce la unidad cruda.
 *  · batt: 0..100; se redondea a entero.
 *  · timestamp: epoch en segundos o ISO; se normaliza a ISO-8601.
 */

const KNOTS_TO_KMH = 1.852;

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
  label: "Traccar Client (OsmAnd)",

  parse(get: ParamGetter): ProviderParseResult {
    const device = get("id");
    const latitude = num(get("lat") ?? get("latitude"));
    const longitude = num(get("lon") ?? get("longitude"));

    if (!device || latitude === null || longitude === null) {
      return {
        ok: false,
        reason: "missing-fields",
        detail: "id, lat y lon son obligatorios",
      };
    }

    const speedKnots = num(get("speed"));
    const battery = num(get("batt") ?? get("battery"));

    return {
      ok: true,
      position: {
        device,
        latitude,
        longitude,
        speedKmh: speedKnots === null ? null : speedKnots * KNOTS_TO_KMH,
        battery: battery === null ? null : Math.round(battery),
        heading: num(get("bearing") ?? get("heading")),
        accuracy: num(get("accuracy") ?? get("hdop")),
        recordedAt: parseRecordedAt(get("timestamp")),
      },
    };
  },
};
