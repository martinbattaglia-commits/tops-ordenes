import { NextResponse } from "next/server";
import { drainKnowledge } from "@/lib/knowledge/drain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/knowledge/drain
 *
 * F0.5.2 / E2.1 — Worker de drenado de la cola de Knowledge (eventos `pending`/`failed`).
 * Pensado para cron cada 5 min — ver .github/workflows/knowledge-drain.yml.
 *
 * Fail-closed: si CRON_SECRET está seteado, exige `Authorization: Bearer <secret>`.
 * `?dry=1` solo cuenta los eventos due (no reclama, no procesa).
 * Códigos: 401 auth · 200 ok/partial · 502 error.
 */
async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";

  try {
    const s = await drainKnowledge({ dry });
    const httpStatus = s.status === "error" ? 502 : 200;
    return NextResponse.json(
      {
        success: s.status !== "error",
        status: s.status,
        dry: s.dry,
        claimed: s.claimed,
        processed: s.processed,
        failed_retried: s.failedRetried,
        failed_dead: s.failedDead,
        retries: s.retries,
        batches: s.batches,
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

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
