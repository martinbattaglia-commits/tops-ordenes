import type { UiDeal } from "@/lib/clientify/mappers";

export interface CacheRow {
  deal_id: number;
  title: string;
  contact_name: string | null;
  company_name: string | null;
  amount: number;
  currency: string;
  stage: string | null;
  stage_id: number | null;
  pipeline: string | null;
  pipeline_id: number | null;
  probability: number;
  status: UiDeal["status"];
  status_label: string | null;
  owner_name: string | null;
  expected_close: string | null;
  actual_close: string | null;
  created_src: string | null;
  modified_src: string | null;
  href: string | null;
  deal_source: string | null;
}

export interface SnapshotRow {
  pipeline_id: number;
  pipeline_name: string;
  deals_total: number;
  deals_active: number;
  total_amount: number;
  active_amount: number;
  forecast_weighted: number;
  won_count: number;
  won_amount: number;
  lost_count: number;
  expired_count: number;
  avg_probability: number;
  sync_run_id: string;
}

const isActive = (d: UiDeal) => d.status !== "won" && d.status !== "lost";
const isLive = (d: UiDeal) => d.status === "open" || d.status === "other"; // excluye expired/won/lost

export function buildCacheRows(deals: UiDeal[]): CacheRow[] {
  return deals.map((d) => ({
    deal_id: d.id,
    title: d.title ?? "",
    contact_name: d.contactName,
    company_name: d.companyName,
    amount: d.amount,
    currency: d.currency || "ARS",
    stage: d.stage,
    stage_id: d.stageId,
    pipeline: d.pipeline,
    pipeline_id: d.pipelineId,
    probability: d.probability ?? 0,
    status: d.status,
    status_label: d.statusLabel,
    owner_name: d.ownerName,
    expected_close: d.expectedClose,
    actual_close: d.actualClose,
    created_src: d.createdAt || null,
    modified_src: d.modifiedAt || null,
    href: d.href,
    deal_source: d.deal_source ?? null,
  }));
}

export function buildSnapshotRows(deals: UiDeal[], runId: string): SnapshotRow[] {
  const byPipeline = new Map<number, UiDeal[]>();
  for (const d of deals) {
    if (d.pipelineId == null) continue;
    const arr = byPipeline.get(d.pipelineId) ?? [];
    arr.push(d);
    byPipeline.set(d.pipelineId, arr);
  }
  const rows: SnapshotRow[] = [];
  for (const [pid, ds] of byPipeline) {
    const active = ds.filter(isActive);
    const live = ds.filter(isLive);
    const sum = (xs: UiDeal[], f: (d: UiDeal) => number) => xs.reduce((a, d) => a + f(d), 0);
    rows.push({
      pipeline_id: pid,
      pipeline_name: ds[0]?.pipeline ?? "—",
      deals_total: ds.length,
      deals_active: active.length,
      total_amount: sum(ds, (d) => d.amount),
      active_amount: sum(live, (d) => d.amount),
      forecast_weighted: sum(live, (d) => (d.amount * (d.probability ?? 0)) / 100),
      won_count: ds.filter((d) => d.status === "won").length,
      won_amount: sum(ds.filter((d) => d.status === "won"), (d) => d.amount),
      lost_count: ds.filter((d) => d.status === "lost").length,
      expired_count: ds.filter((d) => d.status === "expired").length,
      avg_probability: active.length
        ? Math.round((sum(active, (d) => d.probability ?? 0) / active.length) * 100) / 100
        : 0,
      sync_run_id: runId,
    });
  }
  return rows;
}
