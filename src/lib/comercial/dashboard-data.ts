import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { computeKpis, type EnrichedDeal, type Kpis, type ForecastPeriod, type FunnelStage, type SourceStats, type DataQualityReport } from "./dashboard-kpis";
import {
  groupByBusinessUnit, groupByStage, groupByPriorityQuadrant, topOpportunities,
  generateCommercialInsights, generateSuggestedActions, buildAlertGroups,
  getForecastByPeriod, getFunnelData, groupBySource, getDataQuality,
  type BusinessUnit, type StageRow, type QuadrantGroup, type Insight, type ActionItem, type AlertGroup,
} from "./dashboard-insights";

export interface TrendPoint { date: string; forecast: number; active: number; }
export interface SyncStatus {
  status: string; finishedAt: string | null; dealsSynced: number; pipelines: number; errors: number; message: string | null;
  lostReasonEnriched: number; lostReasonSkipped: number; syncVersion: string | null; durationMs: number | null;
}
export interface SyncRun {
  runId: string; status: string; finishedAt: string | null; durationMs: number | null;
  dealsSynced: number; errors: number; lostReasonEnriched: number; lostReasonSkipped: number;
  syncVersion: string | null; message: string | null;
}
export interface Deltas { forecast: number; active: number; }

export interface TableroData {
  configured: boolean;
  deals: EnrichedDeal[];
  kpis: Kpis;
  trends: Record<number, TrendPoint[]>; // pipeline_id → serie
  trendSeries: TrendPoint[];            // serie agregada (todas las pipelines) por fecha
  lastSync: string | null;
  units: BusinessUnit[];
  stages: StageRow[];
  quadrants: QuadrantGroup[];
  topOpps: EnrichedDeal[];
  insights: Insight[];
  actions: ActionItem[];
  alertGroups: AlertGroup[];
  syncStatus: SyncStatus | null;
  syncHistory: SyncRun[];
  deltas: Deltas | null;
  forecastPeriods: ForecastPeriod[];
  funnelStages: FunnelStage[];
  sourceStats: SourceStats[];
  dataQuality: DataQualityReport;
}

const EMPTY_DATA_QUALITY: DataQualityReport = { total: 0, completeness: [], incomplete: [], score: 0, scoreLabel: "critico" };

const EMPTY_KPIS: Kpis = {
  count: 0, liveCount: 0, totalPipeline: 0, activePipeline: 0, forecast: 0, wonAmount: 0, avgProbability: 0,
  weightedConcretion: 0, highProbPipeline: 0, nextCloseValue: 0, overdueCount: 0, overdueAmount: 0,
  noActionCount: 0, stagnantCount: 0, lostCount: 0, lostAmount: 0, wonCount: 0,
  forecastByPeriod: [], sourceBreakdown: [], funnelData: [], dataQuality: EMPTY_DATA_QUALITY,
  bands: [], byPipeline: [],
};

function emptyCockpit(configured: boolean): TableroData {
  return {
    configured, deals: [], kpis: EMPTY_KPIS, trends: {}, trendSeries: [], lastSync: null,
    units: [], stages: [], quadrants: [], topOpps: [], insights: [], actions: [], alertGroups: [],
    syncStatus: null, syncHistory: [], deltas: null,
    forecastPeriods: [], funnelStages: [], sourceStats: [], dataQuality: EMPTY_DATA_QUALITY,
  };
}

export async function getTableroData(): Promise<TableroData> {
  const supabase = createClient();
  // createClient() returns null when Supabase env vars are not configured (demo/build mode).
  if (!supabase) return emptyCockpit(env.clientify.configured);

  const { data: rows } = await supabase
    .from("v_clientify_deals_enriched")
    .select(
      "deal_id,title,company_name,contact_name,amount,currency,pipeline,pipeline_id,stage,status,owner_name,expected_close,actual_close,modified_src,href,effective_probability,overlay_horizonte,overlay_observaciones,deal_source,lost_reason"
    )
    .order("amount", { ascending: false });

  const deals = (rows ?? []).map((r) => ({
    ...r,
    deal_source: (r as { deal_source?: string | null }).deal_source ?? null,
    loss_reason: (r as { lost_reason?: string | null }).lost_reason ?? null,
  })) as EnrichedDeal[];

  const { data: snaps } = await supabase
    .from("clientify_dashboard_snapshots")
    .select("snapshot_date,pipeline_id,forecast_weighted,active_amount")
    .order("snapshot_date", { ascending: true })
    .limit(300);

  const trends: Record<number, TrendPoint[]> = {};
  const byDate = new Map<string, { forecast: number; active: number }>();
  for (const s of snaps ?? []) {
    (trends[s.pipeline_id] ??= []).push({
      date: s.snapshot_date, forecast: Number(s.forecast_weighted), active: Number(s.active_amount),
    });
    const e = byDate.get(s.snapshot_date) ?? { forecast: 0, active: 0 };
    e.forecast += Number(s.forecast_weighted);
    e.active += Number(s.active_amount);
    byDate.set(s.snapshot_date, e);
  }
  const trendSeries: TrendPoint[] = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, forecast: v.forecast, active: v.active }));
  const deltas: Deltas | null = trendSeries.length >= 2
    ? {
        forecast: trendSeries[trendSeries.length - 1].forecast - trendSeries[trendSeries.length - 2].forecast,
        active: trendSeries[trendSeries.length - 1].active - trendSeries[trendSeries.length - 2].active,
      }
    : null;

  const { data: lastLog } = await supabase
    .from("clientify_dashboard_sync_log")
    .select("run_id,status,finished_at,duration_ms,deals_synced,pipelines,errors,message,lost_reason_enriched,lost_reason_skipped,sync_version")
    .order("finished_at", { ascending: false })
    .limit(10);
  const l = lastLog?.[0];
  const syncStatus: SyncStatus | null = l
    ? {
        status: l.status,
        finishedAt: l.finished_at,
        dealsSynced: l.deals_synced ?? 0,
        pipelines: l.pipelines ?? 0,
        errors: l.errors ?? 0,
        message: l.message ?? null,
        lostReasonEnriched: l.lost_reason_enriched ?? 0,
        lostReasonSkipped: l.lost_reason_skipped ?? 0,
        syncVersion: l.sync_version ?? null,
        durationMs: l.duration_ms ?? null,
      }
    : null;
  const syncHistory: SyncRun[] = (lastLog ?? []).map((r) => ({
    runId: r.run_id as string,
    status: r.status as string,
    finishedAt: r.finished_at as string | null,
    durationMs: r.duration_ms as number | null,
    dealsSynced: (r.deals_synced as number | null) ?? 0,
    errors: (r.errors as number | null) ?? 0,
    lostReasonEnriched: (r.lost_reason_enriched as number | null) ?? 0,
    lostReasonSkipped: (r.lost_reason_skipped as number | null) ?? 0,
    syncVersion: r.sync_version as string | null,
    message: r.message as string | null,
  }));
  const lastSync = l?.status === "completed" ? (l.finished_at as string | null) ?? null : null;

  if (!deals.length) {
    return { ...emptyCockpit(env.clientify.configured), trends, trendSeries, deltas, syncStatus, syncHistory, lastSync };
  }

  const today = new Date();
  const kpis = computeKpis(deals, today);

  return {
    configured: env.clientify.configured,
    deals,
    kpis,
    trends,
    trendSeries,
    lastSync,
    units: groupByBusinessUnit(deals),
    stages: groupByStage(deals),
    quadrants: groupByPriorityQuadrant(deals, today),
    topOpps: topOpportunities(deals, today, 6),
    insights: generateCommercialInsights(deals, kpis),
    actions: generateSuggestedActions(deals, today, 5),
    alertGroups: buildAlertGroups(deals, today),
    syncStatus,
    syncHistory,
    deltas,
    forecastPeriods: getForecastByPeriod(deals, today),
    funnelStages: getFunnelData(deals),
    sourceStats: groupBySource(deals),
    dataQuality: getDataQuality(deals),
  };
}
