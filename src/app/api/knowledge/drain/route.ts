import { NextResponse } from "next/server";
import { drainKnowledge } from "@/lib/knowledge/drain";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/knowledge/drain
 *
 * F0.5.2 / E2.1 — Worker de drenado de la cola de Knowledge (eventos `pending`/`failed`).
 * Pensado para cron cada 5 min — ver .github/workflows/knowledge-drain.yml.
 *
 * Auth (KDW-001): FAIL-CLOSED ESTRICTO vía requireCronAuth() — el guard canónico
 * de los demás endpoints de cron del ERP. Sin CRON_SECRET → 503 (misconfig visible,
 * nunca queda abierto); Authorization ausente o Bearer incorrecto → 401 (timing-safe).
 * Reemplaza el patrón fail-open `if (secret) { ... }` (hallazgo #1 de la auditoría de
 * permisos 2026-06-28), que dejaba el endpoint ABIERTO si la env var faltaba.
 * `?dry=1` solo cuenta los eventos due (no reclama, no procesa).
 * Códigos: 503 misconfig · 401 auth · 200 ok/partial · 502 error.
 */
async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;

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
