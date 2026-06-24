import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { computeKpis, type EnrichedDeal, type Kpis } from "./dashboard-kpis";

export interface TrendPoint { date: string; forecast: number; active: number; }
export interface TableroData {
  configured: boolean;
  deals: EnrichedDeal[];
  kpis: Kpis;
  trends: Record<number, TrendPoint[]>; // pipeline_id → serie (últimos 30 snapshots)
  lastSync: string | null;
}

const EMPTY_KPIS: Kpis = {
  count: 0, totalPipeline: 0, activePipeline: 0, forecast: 0, wonAmount: 0, avgProbability: 0,
  weightedConcretion: 0, overdueCount: 0, overdueAmount: 0, bands: [], byPipeline: [],
};

export async function getTableroData(): Promise<TableroData> {
  const supabase = createClient();
  // createClient() returns null when Supabase env vars are not configured (demo/build mode).
  if (!supabase) {
    return { configured: env.clientify.configured, deals: [], kpis: EMPTY_KPIS, trends: {}, lastSync: null };
  }

  const { data: rows } = await supabase
    .from("v_clientify_deals_enriched")
    .select(
      "deal_id,title,company_name,contact_name,amount,currency,pipeline,pipeline_id,stage,status,owner_name,expected_close,modified_src,href,effective_probability,overlay_horizonte,overlay_observaciones"
    )
    .order("amount", { ascending: false });

  const deals = (rows ?? []) as EnrichedDeal[];

  const { data: snaps } = await supabase
    .from("clientify_dashboard_snapshots")
    .select("snapshot_date,pipeline_id,forecast_weighted,active_amount")
    .order("snapshot_date", { ascending: true })
    .limit(300);

  const trends: Record<number, TrendPoint[]> = {};
  for (const s of snaps ?? []) {
    (trends[s.pipeline_id] ??= []).push({
      date: s.snapshot_date, forecast: Number(s.forecast_weighted), active: Number(s.active_amount),
    });
  }

  const { data: log } = await supabase
    .from("clientify_sync_log")
    .select("finished_at,status")
    .eq("status", "completed")
    .order("finished_at", { ascending: false })
    .limit(1);

  return {
    configured: env.clientify.configured,
    deals,
    kpis: deals.length ? computeKpis(deals, new Date()) : EMPTY_KPIS,
    trends,
    lastSync: log?.[0]?.finished_at ?? null,
  };
}
