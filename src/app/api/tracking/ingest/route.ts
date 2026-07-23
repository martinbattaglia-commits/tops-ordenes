import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getProvider, DEFAULT_PROVIDER_ID } from "@/lib/tracking/provider";
import { timingSafeStringEqual } from "@/lib/cron-auth";
import { createSupabasePersistence } from "@/lib/tracking/persistence/supabase";
import { createTrackingEngine } from "@/lib/tracking/engine";

/**
 * Endpoint de ingesta de posiciones.
 *
 * Pipeline desacoplado: Provider → Engine → Persistence → Realtime.
 *
 * Compatibilidad de transporte (robusta para Traccar Client / OsmAnd, iOS y
 * Android, GET y POST): los parámetros (incluido `token`) se leen del query
 * string Y del body, sea el body form-urlencoded o JSON. Traccar Client en
 * modo OsmAnd puede mandar los datos en cualquiera de los dos según versión y
 * plataforma; este handler los acepta en ambos lados sin asumir.
 */

export const dynamic = "force-dynamic";

/**
 * Parsea un body crudo que puede venir como form-urlencoded ("a=b&c=d") o JSON
 * (plano o anidado, p.ej. { location: { coords: {...} } }). Devuelve un mapa
 * key→value aplanado.
 */
function parseBody(raw: string, contentType: string): URLSearchParams {
  const out = new URLSearchParams();
  if (!raw) return out;
  const ct = contentType.toLowerCase();
  const looksJson = raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[");
  if (ct.includes("application/json") || looksJson) {
    try {
      const obj = JSON.parse(raw);
      const flat: Record<string, string> = {};
      const walk = (o: unknown): void => {
        if (o && typeof o === "object") {
          for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
            if (v && typeof v === "object") walk(v);
            else if (v != null) flat[k] = String(v);
          }
        }
      };
      walk(obj);
      for (const [k, v] of Object.entries(flat)) out.set(k, v);
      return out;
    } catch {
      // No era JSON válido → cae a form-urlencoded.
    }
  }
  return new URLSearchParams(raw);
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const token = env.tracking.ingestToken;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Tracking ingest not configured" },
      { status: 503 }
    );
  }

  const params = req.nextUrl.searchParams;
  const contentType = req.headers.get("content-type") ?? "";

  // Body crudo para POST (cualquier content-type). req.text() se consume 1 vez.
  let raw = "";
  if (req.method === "POST") {
    try {
      raw = await req.text();
    } catch {
      raw = "";
    }
  }
  const body = parseBody(raw, contentType);

  // Lectura de parámetros: query primero, luego body. Cubre GET y POST,
  // token-en-query + datos-en-body, o todo junto en cualquiera de los dos.
  const get = (key: string): string | null =>
    params.get(key) ?? body.get(key) ?? null;

  // F4.4-E2: comparación timing-safe (antes `!==`). El fail-closed ya existía
  // (503 sin TRACKING_INGEST_TOKEN, arriba).
  if (!timingSafeStringEqual(get("token") ?? "", token)) {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  // ---- Provider: payload crudo → NormalizedPosition ----------------------
  const provider = getProvider(DEFAULT_PROVIDER_ID);
  if (!provider) {
    return NextResponse.json(
      { ok: false, error: "No tracking provider registered" },
      { status: 503 }
    );
  }

  const parsed = provider.parse(get);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.detail }, { status: 400 });
  }

  // ---- Engine + Persistence ---------------------------------------------
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "Service role not configured" },
      { status: 503 }
    );
  }

  const engine = createTrackingEngine(createSupabasePersistence(admin));
  const outcome = await engine.ingest(parsed.position);

  if (!outcome.ok) {
    if (outcome.reason === "unknown-device") {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          mod: "tracking",
          op: "ingest.unknown-device",
          device: outcome.device,
        })
      );
      return NextResponse.json(
        { ok: false, ignored: "unknown-device", device: outcome.device },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: false, error: outcome.detail }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
