import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchConnectOutbox } from "@/lib/connect/worker/dispatch";
import { automationProcessor } from "@/lib/connect/worker/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/connect/cron/dispatch-outbox
 *
 * F4.1A — Worker de drenado de connect_outbox (ruta canónica del spec §A4/NOTIF-1).
 * Scheduling: Netlify Scheduled Function `netlify/functions/connect-dispatch-outbox.mts`
 * cada 5 min (D-F41-9; GH Actions descartado: cron solo corre desde la default branch).
 *
 * FAIL-CLOSED ESTRICTO (endurecido vs /api/knowledge/drain): si CRON_SECRET NO está
 * configurado, responde 503 (misconfig visible) — nunca queda abierto. Con secret,
 * exige `Authorization: Bearer <secret>`.
 * `?dry=1` solo cuenta los eventos due (no reclama, no procesa) — D-F41-3.
 * Códigos: 503 misconfig · 401 auth · 200 ok/partial · 502 error.
 */
async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET no configurado (fail-closed)" },
      { status: 503 },
    );
  }
  // Comparación timing-safe (patrón clientify/webhook; endurecido vs /api/knowledge/drain).
  const auth = req.headers.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(auth);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const batchSize = clampInt(url.searchParams.get("batchSize"), 1, 200);
  const maxBatches = clampInt(url.searchParams.get("maxBatches"), 1, 50);

  try {
    // F4.4-E4: el worker despacha con el processor de automatizaciones MVP.
    // Compat total con F4.1: topic sin reglas habilitadas (o mig 0172 sin
    // aplicar) ⇒ `skipped`, idéntico al governanceProcessor anterior.
    const s = await dispatchConnectOutbox(
      {
        dry,
        ...(batchSize != null ? { batchSize } : {}),
        ...(maxBatches != null ? { maxBatches } : {}),
      },
      automationProcessor,
    );
    const httpStatus = s.status === "error" ? 502 : 200;
    return NextResponse.json(
      {
        success: s.status !== "error",
        status: s.status,
        dry: s.dry,
        claimed: s.claimed,
        processed: s.processed,
        skipped: s.skipped,
        failed_retried: s.failedRetried,
        failed_dead: s.failedDead,
        retries: s.retries,
        batches: s.batches,
        pruned: s.pruned,
        pending_remaining: s.pendingRemaining,
        avg_event_ms: s.avgEventMs,
        max_event_ms: s.maxEventMs,
        duration_ms: s.durationMs,
        correlation_id: s.correlationId,
        errors: s.errors,
      },
      { status: httpStatus },
    );
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

function clampInt(raw: string | null, min: number, max: number): number | null {
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return null;
  return Math.min(Math.max(n, min), max);
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
