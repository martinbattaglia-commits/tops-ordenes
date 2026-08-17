import type { NormalizedPosition } from "./types";

/**
 * Parser del payload de FORWARD de Traccar Server (piloto hardware FMC130).
 *
 * Traccar Server decodifica el protocolo binario Teltonika (TCP :5027) y
 * reenvía cada posición como JSON (forward.type=json). Este parser traduce ese
 * JSON a una NormalizedPosition SIN el campo `device`: el IMEI se resuelve a
 * device_identifier en el route (device-map). Reusa el mismo contrato que el
 * resto del tracking → Engine/Persistence no cambian.
 *
 * Shape típico del forward de Traccar:
 *   {
 *     "position": { "latitude", "longitude", "speed"(NUDOS), "course",
 *                   "fixTime"|"deviceTime"(ISO), "accuracy",
 *                   "attributes": { "batteryLevel"(0..100), "ignition", "motion", "power" } },
 *     "device":   { "uniqueId": "<IMEI>", "name", "status" }
 *   }
 *
 * Robustez: acepta IMEI en device.uniqueId | uniqueId (raíz/position); lat/lng
 * en position.* o en la raíz. La velocidad de Traccar viene en NUDOS → km/h
 * (×1.852). Campos ignition/motion/power NO se persisten (fleet_positions no
 * tiene columnas para ellos; ver docs — requeriría migración aprobada).
 */

const KNOTS_TO_KMH = 1.852;

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIso(v: unknown): string | null {
  if (typeof v === "number") {
    const d = new Date(v > 1e12 ? v : v * 1000); // epoch ms o s
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string" && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export type ForwardParseResult =
  | { ok: true; imei: string; position: Omit<NormalizedPosition, "device"> }
  | { ok: false; reason: "missing-fields"; detail: string };

export function parseTraccarForward(body: unknown): ForwardParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "missing-fields", detail: "body no es un objeto JSON" };
  }
  const b = body as Record<string, unknown>;
  const position = (b.position && typeof b.position === "object" ? b.position : b) as Record<string, unknown>;
  const device = (b.device && typeof b.device === "object" ? b.device : {}) as Record<string, unknown>;
  const attrs = (position.attributes && typeof position.attributes === "object"
    ? position.attributes
    : {}) as Record<string, unknown>;

  const imei =
    (typeof device.uniqueId === "string" && device.uniqueId) ||
    (typeof b.uniqueId === "string" && b.uniqueId) ||
    (typeof position.uniqueId === "string" && position.uniqueId) ||
    "";
  const latitude = num(position.latitude ?? b.latitude);
  const longitude = num(position.longitude ?? b.longitude);

  if (!imei || latitude === null || longitude === null) {
    return {
      ok: false,
      reason: "missing-fields",
      detail: "uniqueId/IMEI, latitude y longitude son obligatorios",
    };
  }

  const speedKnots = num(position.speed);
  const speedKmh = speedKnots === null || speedKnots < 0 ? null : speedKnots * KNOTS_TO_KMH;

  const batteryRaw = num(attrs.batteryLevel ?? attrs.battery);
  const battery = batteryRaw === null ? null : Math.max(0, Math.min(100, Math.round(batteryRaw)));

  const accuracyRaw = num(position.accuracy);
  const accuracy = accuracyRaw === null || accuracyRaw <= 0 ? null : accuracyRaw;

  // Fallback a "ahora" solo si NO vino ningún timestamp (el FMC130 siempre manda
  // fixTime → es teórico). Ojo: un payload sin timestamp reenviado 2 veces tomaría
  // dos "ahora" distintos, y el dedupe por recorded_at no lo cubriría.
  const recordedAt =
    toIso(position.fixTime) ??
    toIso(position.deviceTime) ??
    toIso(b.fixTime) ??
    new Date().toISOString();

  return {
    ok: true,
    imei: imei.trim(),
    position: {
      latitude,
      longitude,
      speedKmh,
      battery,
      heading: num(position.course ?? position.heading),
      accuracy,
      recordedAt,
    },
  };
}
