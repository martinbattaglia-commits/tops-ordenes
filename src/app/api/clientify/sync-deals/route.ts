import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { listDeals, listPipelines, ClientifyError } from "@/lib/clientify/client";
import { mapDeal } from "@/lib/clientify/mappers";
import { isVisibleCommercialPipeline } from "@/lib/comercial/pipeline-filter";
import { persistDealsSync } from "@/lib/comercial/dashboard-sync-db";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/clientify/sync-deals
 * Snapshot diario de deals de Clientify → Supabase (caché + snapshots).
 * Cron 21:00 ART vía .github/workflows/clientify-dashboard-sync.yml.
 * Auth: si CRON_SECRET está seteado, exige Authorization: Bearer <secret>.
 * `?dry=1` recorre y reporta sin escribir. Status: 401 cron · 200 ok · 502 error · 503 sin key.
 */
async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  if (!env.clientify.configured) {
    return NextResponse.json({ ok: false, error: "CLIENTIFY_API_KEY no configurada" }, { status: 503 });
  }

  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const runId = randomUUID();
  const started = Date.now();

  // Cliente service-role para la bitácora. En escritura (no dry-run) es obligatorio:
  // si falta, devolvemos 503 en vez de sincronizar sin dejar fila de auditoría.
  const admin = createAdminClient();
  if (!dryRun && !admin) {
    return NextResponse.json({ ok: false, error: "Supabase admin no disponible" }, { status: 503 });
  }

  try {
    const pipelinesRes = await listPipelines();
    // Solo pipelines comerciales visibles (ANMAT / Cargas Generales / Oficinas).
    const pipelines = pipelinesRes.results.filter((p) => isVisibleCommercialPipeline(p.name));

    const dealsByPipeline = await Promise.all(
      pipelines.map(async (p) => {
        const res = await listDeals({ pipeline_id: p.id, page_size: 500, ordering: "-modified" });
        return res.results.map(mapDeal);
      })
    );
    const deals = dealsByPipeline.flat();

    let persisted = { cached: 0, snapshots: 0 };
    if (!dryRun) {
      persisted = await persistDealsSync(deals, runId);
      const elapsed = Date.now() - started;
      await admin?.from("clientify_sync_log").insert({
        run_id: runId,
        trigger: "cron",
        status: "completed",
        finished_at: new Date().toISOString(),
        duration_ms: elapsed,
        pipelines: pipelines.length,
        deals_synced: deals.length,
        errors: 0,
        message: `OK ${deals.length} deals / ${persisted.snapshots} snapshots`,
      });
    }

    return NextResponse.json({
      ok: true,
      runId,
      dryRun,
      syncedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      pipelines: pipelines.length,
      totalDeals: deals.length,
      cached: persisted.cached,
      snapshots: persisted.snapshots,
    });
  } catch (e) {
    const status = e instanceof ClientifyError && e.status >= 400 && e.status < 600 ? e.status : 502;
    // Bitácora de error (best-effort, no rompe la respuesta).
    try {
      await admin?.from("clientify_sync_log").insert({
        run_id: runId, trigger: "cron", status: "error",
        finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
        errors: 1, message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* noop */ }
    return NextResponse.json(
      { ok: false, runId, error: e instanceof Error ? e.message : String(e) },
      { status }
    );
  }
}

export async function GET(req: Request): Promise<Response> { return handle(req); }
export async function POST(req: Request): Promise<Response> { return handle(req); }
