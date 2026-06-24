export interface EnrichedDeal {
  deal_id: number;
  title: string;
  company_name: string | null;
  contact_name: string | null;
  amount: number;
  currency: string;
  pipeline: string | null;
  pipeline_id: number | null;
  stage: string | null;
  status: "open" | "expired" | "won" | "lost" | "other";
  owner_name: string | null;
  expected_close: string | null;
  modified_src: string | null;
  href: string;
  effective_probability: number;        // overlay.probabilidad ?? clientify.probability
  overlay_horizonte: string | null;
  overlay_observaciones: string | null;
}

export interface Kpis {
  count: number;
  totalPipeline: number;   // Σ amount (todos)
  activePipeline: number;  // Σ amount (open/other) — pipeline vivo
  forecast: number;        // Σ amount*prob/100 (open/other)
  wonAmount: number;
  avgProbability: number;
  byPipeline: { id: number; name: string; active: number; forecast: number; count: number }[];
}

export interface Alert { kind: "overdue" | "stale" | "lowprob"; label: string; }

const isLive = (d: EnrichedDeal) => d.status === "open" || d.status === "other";
const STALE_DAYS = 21;

export function computeKpis(deals: EnrichedDeal[]): Kpis {
  const live = deals.filter(isLive);
  const sum = (xs: EnrichedDeal[], f: (d: EnrichedDeal) => number) => xs.reduce((a, d) => a + f(d), 0);
  const byMap = new Map<number, { id: number; name: string; active: number; forecast: number; count: number }>();
  for (const d of live) {
    if (d.pipeline_id == null) continue;
    const e = byMap.get(d.pipeline_id) ?? { id: d.pipeline_id, name: d.pipeline ?? "—", active: 0, forecast: 0, count: 0 };
    e.active += d.amount;
    e.forecast += (d.amount * d.effective_probability) / 100;
    e.count += 1;
    byMap.set(d.pipeline_id, e);
  }
  return {
    count: deals.length,
    totalPipeline: sum(deals, (d) => d.amount),
    activePipeline: sum(live, (d) => d.amount),
    forecast: sum(live, (d) => (d.amount * d.effective_probability) / 100),
    wonAmount: sum(deals.filter((d) => d.status === "won"), (d) => d.amount),
    avgProbability: live.length ? Math.round(sum(live, (d) => d.effective_probability) / live.length) : 0,
    byPipeline: [...byMap.values()].sort((a, b) => b.active - a.active),
  };
}

export function dealAlerts(d: EnrichedDeal, today: Date): Alert[] {
  if (!isLive(d)) return [];
  const out: Alert[] = [];
  if (d.expected_close && new Date(d.expected_close + "T12:00:00") < today)
    out.push({ kind: "overdue", label: "Cierre estimado vencido" });
  if (d.modified_src) {
    const days = (today.getTime() - new Date(d.modified_src).getTime()) / 86_400_000;
    if (days >= STALE_DAYS) out.push({ kind: "stale", label: `Sin actividad ${Math.floor(days)} días` });
  }
  if (d.effective_probability > 0 && d.effective_probability < 15)
    out.push({ kind: "lowprob", label: "Probabilidad baja" });
  return out;
}
