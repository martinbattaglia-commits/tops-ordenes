import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { consumeMakeRelayBatch } from "@/lib/whatsapp/make-relay-worker";
import { createSupabaseMakeRelayPorts } from "@/lib/whatsapp/make-relay-worker.supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Drena la outbox durable Nexus → Make. Sólo contadores; nunca payloads. */
async function handle(req: Request): Promise<Response> {
  const auth = requireCronAuth(req);
  if (auth) return auth;

  // Kill-switch: apagado significa PAUSA, nunca marcar filas como entregadas.
  if (process.env.WHATSAPP_MAKE_RELAY_ENABLED !== "1") {
    return NextResponse.json({ success: true, paused: true });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ success: false, error: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }

  const url = new URL(req.url);
  // Una sola fila por invocación: con timeout de egress de hasta 5 s, reclamar
  // un lote antes de entregarlo podría consumir intentos de filas nunca iniciadas.
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "1", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1) : 1;
  const result = await consumeMakeRelayBatch(
    createSupabaseMakeRelayPorts(admin as never),
    { limit },
  );
  return NextResponse.json({
    success: result.errors.length === 0,
    paused: false,
    claimed: result.claimed,
    delivered: result.delivered,
    requeued: result.requeued,
    dead: result.dead,
    errors: result.errors,
  }, { status: result.errors.length === 0 ? 200 : 502 });
}

export const GET = handle;
export const POST = handle;
