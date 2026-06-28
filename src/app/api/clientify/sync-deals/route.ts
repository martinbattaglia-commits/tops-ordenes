import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { listDeals, listPipelines, getDeal, ClientifyError } from "@/lib/clientify/client";
import { mapDeal } from "@/lib/clientify/mappers";
import { normalizeLossReason } from "@/lib/clientify/loss-reason-normalizer";
import { isVisibleCommercialPipeline } from "@/lib/comercial/pipeline-filter";
import { persistDealsSync } from "@/lib/comercial/dashboard-sync-db";
import { reinjectedStoredReasons, buildStoredReasonsMap, checkLostReasonIntegrity } from "@/lib/comercial/sync-lost-reason";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Versión del sincronizador — incrementar ante cambios de contrato o lógica de enriquecimiento. */
const SYNC_VERSION = "2.1.0";

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

    // Enriquecer deals perdidos con lost_reason (campo nativo de Clientify disponible
    // SOLO en GET /deals/{id}/, no en el endpoint de lista).
    //
    // Optimización: solo se hace fetch individual para deals que:
    //   1. Son nuevos en estado "lost" (no están en caché con lost_reason ya almacenado), O
    //   2. Ya están en caché como "lost" pero lost_reason es null (nunca se enriqueció).
    // Deals perdidos con lost_reason ya almacenado NO se re-consultan.
    const lostDeals = deals.filter((d) => d.status === "lost");
    let enrichedCount = 0;
    let skippedCount = 0;
    let previousEnrichedCount = 0; // para el health check
    if (lostDeals.length > 0) {
      // Leer del admin qué deal_ids ya tienen lost_reason almacenado en la caché,
      // y recuperar su valor actual para reinyectarlo después del REPLACE completo.
      // Sin esto, la RPC (DELETE+INSERT) borra lost_reason en cada sync posterior al primero.
      const adminForRead = createAdminClient();
      const alreadyEnriched = new Set<number>();
      let storedReasonsMap = new Map<number, string>();
      if (adminForRead) {
        const { data } = await adminForRead
          .from("clientify_deals_cache")
          .select("deal_id, lost_reason")
          .eq("status", "lost")
          .not("lost_reason", "is", null);
        storedReasonsMap = buildStoredReasonsMap(
          (data ?? []).map((r) => ({ deal_id: r.deal_id as number, lost_reason: r.lost_reason as string | null }))
        );
        for (const id of storedReasonsMap.keys()) alreadyEnriched.add(id);
        previousEnrichedCount = alreadyEnriched.size;
      }

      const toEnrich = lostDeals.filter((d) => !alreadyEnriched.has(d.id));
      skippedCount = lostDeals.length - toEnrich.length;

      // Reinyectar valores ya almacenados antes del REPLACE completo de la RPC.
      // Sin esto, el DELETE+INSERT borraría lost_reason de los deals omitidos.
      reinjectedStoredReasons(deals, storedReasonsMap);

      // Fetch individual solo para los que necesitan enriquecimiento.
      // Rate limit Clientify: 300 req/min → lotes de 10 con pausa de 300ms entre lotes.
      const BATCH = 10;
      for (let i = 0; i < toEnrich.length; i += BATCH) {
        const batch = toEnrich.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (d) => {
            try {
              const full = await getDeal(d.id);
              // Normaliza antes de persistir: unifica variantes libres → categorías canónicas.
              d.lossReason = normalizeLossReason(full.lost_reason);
              enrichedCount++;
            } catch {
              // Best-effort: si falla un deal individual, no interrumpe el sync.
            }
          })
        );
        if (i + BATCH < toEnrich.length) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    let persisted = { cached: 0, snapshots: 0 };
    if (!dryRun) {
      persisted = await persistDealsSync(deals, runId);

      // Health check: verifica que no se hayan perdido lost_reason entre syncs.
      const health = checkLostReasonIntegrity(previousEnrichedCount, deals);

      const elapsed = Date.now() - started;
      const baseMessage = `OK ${deals.length} deals / ${persisted.snapshots} snapshots / lost_reason: ${enrichedCount} enriquecidos, ${skippedCount} omitidos (ya almacenados)`;
      const message = health.warning ? `${baseMessage} | ${health.warning}` : baseMessage;

      await admin?.from("clientify_dashboard_sync_log").insert({
        run_id: runId,
        trigger: "cron",
        status: health.ok ? "completed" : "completed_with_warnings",
        finished_at: new Date().toISOString(),
        duration_ms: elapsed,
        pipelines: pipelines.length,
        deals_synced: deals.length,
        errors: 0,
        lost_reason_enriched: enrichedCount,
        lost_reason_skipped: skippedCount,
        sync_version: SYNC_VERSION,
        message,
      });
    }

    return NextResponse.json({
      ok: true,
      runId,
      dryRun,
      syncVersion: SYNC_VERSION,
      syncedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      pipelines: pipelines.length,
      totalDeals: deals.length,
      cached: persisted.cached,
      snapshots: persisted.snapshots,
      lostReason: { enriched: enrichedCount, skipped: skippedCount },
    });
  } catch (e) {
    const status = e instanceof ClientifyError && e.status >= 400 && e.status < 600 ? e.status : 502;
    // Bitácora de error (best-effort, no rompe la respuesta).
    try {
      await admin?.from("clientify_dashboard_sync_log").insert({
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
