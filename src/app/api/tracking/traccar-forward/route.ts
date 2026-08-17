import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { createSupabasePersistence } from "@/lib/tracking/persistence/supabase";
import { parseTraccarForward } from "@/lib/tracking/provider/traccar-forward";
import { resolveDeviceMapping } from "@/lib/tracking/device-map";

/**
 * Adaptador de FORWARD de Traccar Server → Nexus (piloto hardware FMC130).
 *
 * Flujo: FMC130 (Teltonika/TCP :5027) → Traccar Server → forward JSON → ESTE
 * endpoint → resuelve IMEI a device_identifier (device-map) → reusa la
 * persistencia del tracking (resolveVehicleByDevice / insertPosition /
 * touchVehicle). Dedupe best-effort por (vehicle_id, recorded_at) — sin unique
 * constraint en DB (ver docs; migración futura). No toca el pipeline
 * OsmAnd de /api/tracking/ingest (el iPhone sigue como provider secundario).
 *
 * Auth: `Authorization: Bearer TRACKING_FORWARD_SECRET` (comparación
 * constant-time). Ruta pública en middleware (server-to-server, sin sesión),
 * protegida por su propio secreto.
 *
 * Códigos: 200 aceptado (o duplicado idempotente) · 401 secret inválido ·
 * 400 payload inválido · 422 IMEI sin mapear · 404 mapeado pero sin vehículo ·
 * 503 no configurado · 500 error de persistencia (logueado, sin filtrar detalle).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bearerOk(header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function log(level: "warn" | "error", op: string, extra: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    mod: "tracking",
    op: `forward.${op}`,
    ...extra,
  });
  if (level === "error") console.error(line);
  else console.warn(line);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!env.tracking.forwardConfigured) {
    return NextResponse.json({ ok: false, error: "Forward not configured" }, { status: 503 });
  }
  if (!bearerOk(req.headers.get("authorization"), env.tracking.forwardSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseTraccarForward(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.detail }, { status: 400 });
  }

  const mapping = resolveDeviceMapping(parsed.imei);
  if (!mapping) {
    log("warn", "unmapped-imei", { imeiTail: parsed.imei.slice(-4) });
    return NextResponse.json({ ok: false, error: "IMEI not mapped" }, { status: 422 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Service role not configured" }, { status: 503 });
  }
  const persistence = createSupabasePersistence(admin);

  try {
    const vehicle = await persistence.resolveVehicleByDevice(mapping.device_identifier);
    if (!vehicle) {
      log("warn", "unresolved-vehicle", { device: mapping.device_identifier });
      return NextResponse.json(
        { ok: false, error: "Device mapped but vehicle not found" },
        { status: 404 }
      );
    }

    // Dedupe best-effort: misma (vehicle_id, recorded_at) = reenvío de Traccar →
    // no duplicar. NO es idempotencia garantizada: falta un unique index
    // (migración futura), así que dos reenvíos concurrentes podrían insertar
    // ambos. Uso limit(1) (no maybeSingle) para no romper con 500 si ya
    // existiera un duplicado previo.
    const { data: existing, error: dupErr } = await admin
      .from("fleet_positions")
      .select("id")
      .eq("vehicle_id", vehicle.id)
      .eq("recorded_at", parsed.position.recordedAt)
      .limit(1);
    if (dupErr) throw new Error(dupErr.message);
    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }

    const { positionId } = await persistence.insertPosition(vehicle.id, {
      device: mapping.device_identifier,
      ...parsed.position,
    });
    // touchVehicle es bookkeeping ("última comunicación"): su fallo NO debe
    // invalidar una posición ya persistida (evitaría un 500 + reintento de un
    // punto ya guardado).
    try {
      await persistence.touchVehicle(vehicle.id);
    } catch {
      log("warn", "touch-failed", { positionId });
    }

    return NextResponse.json({ ok: true, positionId }, { status: 200 });
  } catch (err) {
    log("error", "persist-error", { detail: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ ok: false, error: "Persist error" }, { status: 500 });
  }
}
