import { NextResponse } from "next/server";
import { listDeals, listPipelines, ClientifyError } from "@/lib/clientify/client";
import { mapDeal } from "@/lib/clientify/mappers";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/clientify/sync-deals
 *
 * Endpoint cron-friendly que tira un snapshot de deals de Clientify
 * y devuelve el resumen. En F2.7 se conecta a Supabase para persistir
 * un cache local (tabla `clientify_deals_cache`).
 *
 * Auth: si está seteado `CRON_SECRET`, requiere `Authorization: Bearer <secret>`.
 * Caso contrario, abierto (útil para testing local).
 */
export async function GET(req: Request) {
  // Optional cron secret protection
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!env.clientify.configured) {
    return NextResponse.json(
      { ok: false, error: "CLIENTIFY_API_KEY no configurada" },
      { status: 503 }
    );
  }

  const started = Date.now();
  try {
    const pipelinesRes = await listPipelines();
    const pipelineIds = pipelinesRes.results.map((p) => p.id);

    // Para cada pipeline traemos hasta 500 deals modificados recientemente
    const dealsByPipeline = await Promise.all(
      pipelineIds.map(async (pid) => {
        const res = await listDeals({
          pipeline_id: pid,
          page_size: 500,
          ordering: "-modified",
        });
        return { pipelineId: pid, deals: res.results.map(mapDeal) };
      })
    );

    const allDeals = dealsByPipeline.flatMap((p) => p.deals);
    const open = allDeals.filter((d) => d.status === "open");
    const won = allDeals.filter((d) => d.status === "won");
    const lost = allDeals.filter((d) => d.status === "lost");

    const elapsed = Date.now() - started;
    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      elapsedMs: elapsed,
      pipelines: pipelinesRes.results.length,
      totalDeals: allDeals.length,
      summary: {
        open: { count: open.length, amount: open.reduce((a, d) => a + d.amount, 0) },
        won: { count: won.length, amount: won.reduce((a, d) => a + d.amount, 0) },
        lost: { count: lost.length, amount: lost.reduce((a, d) => a + d.amount, 0) },
      },
      byPipeline: dealsByPipeline.map((p) => ({
        pipelineId: p.pipelineId,
        pipelineName: pipelinesRes.results.find((pp) => pp.id === p.pipelineId)?.name ?? "—",
        dealsCount: p.deals.length,
      })),
    });
  } catch (e) {
    if (e instanceof ClientifyError) {
      return NextResponse.json(
        { ok: false, error: e.message, status: e.status },
        { status: e.status >= 400 && e.status < 600 ? e.status : 502 }
      );
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
