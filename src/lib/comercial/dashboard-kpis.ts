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
  effective_probability: number;        // probabilidad de Clientify (foto del último corte) — NO editable en Nexus
  overlay_horizonte: string | null;
  overlay_observaciones: string | null;
}

export interface ProbBand {
  key: "alta" | "media" | "baja";
  label: string;
  count: number;
  amount: number;    // Σ amount del pipeline vivo en la banda
  forecast: number;  // Σ amount*prob/100 en la banda
}

export interface Kpis {
  count: number;
  totalPipeline: number;       // Σ amount (todos)
  activePipeline: number;      // Σ amount (open/other) — pipeline vivo
  forecast: number;            // Σ amount*prob/100 (open/other)
  wonAmount: number;
  avgProbability: number;      // promedio simple de prob. (sin ponderar)
  weightedConcretion: number;  // forecast/activePipeline*100 — prob. de concreción ponderada por monto
  highProbPipeline: number;    // Σ amount de vivas con prob ≥ 70
  nextCloseValue: number;      // Σ amount de vivas con cierre estimado en ≤ 30 días (no vencidas)
  overdueCount: number;        // deals vivos con fecha estimada vencida
  overdueAmount: number;
  noActionCount: number;       // vivas sin movimiento ≥ 21 días (proxy "sin próxima acción")
  bands: ProbBand[];           // pipeline vivo por banda de prob. (alta/media/baja)
  byPipeline: { id: number; name: string; active: number; forecast: number; count: number }[];
}

export interface Alert { kind: "overdue" | "stale" | "lowprob"; label: string; }

const isLive = (d: EnrichedDeal) => d.status === "open" || d.status === "other";
const STALE_DAYS = 21;

export function computeKpis(deals: EnrichedDeal[], today: Date): Kpis {
  const live = deals.filter(isLive);
  const sum = (xs: EnrichedDeal[], f: (d: EnrichedDeal) => number) => xs.reduce((a, d) => a + f(d), 0);
  const fc = (d: EnrichedDeal) => (d.amount * d.effective_probability) / 100;

  const byMap = new Map<number, { id: number; name: string; active: number; forecast: number; count: number }>();
  for (const d of live) {
    if (d.pipeline_id == null) continue;
    const e = byMap.get(d.pipeline_id) ?? { id: d.pipeline_id, name: d.pipeline ?? "—", active: 0, forecast: 0, count: 0 };
    e.active += d.amount;
    e.forecast += fc(d);
    e.count += 1;
    byMap.set(d.pipeline_id, e);
  }

  const activePipeline = sum(live, (d) => d.amount);
  const forecast = sum(live, fc);

  const bandKey = (p: number): ProbBand["key"] => (p >= 50 ? "alta" : p > 20 ? "media" : "baja");
  const bands: ProbBand[] = (
    [
      { key: "alta", label: "Alta (≥50%)" },
      { key: "media", label: "Media (21–49%)" },
      { key: "baja", label: "Baja (≤20%)" },
    ] as const
  ).map(({ key, label }) => {
    const xs = live.filter((d) => bandKey(d.effective_probability) === key);
    return { key, label, count: xs.length, amount: sum(xs, (d) => d.amount), forecast: sum(xs, fc) };
  });

  const overdue = live.filter(
    (d) => d.expected_close && new Date(d.expected_close + "T12:00:00") < today
  );
  const daysTo = (s: string) => (new Date(s + "T12:00:00").getTime() - today.getTime()) / 86_400_000;
  const daysSince = (s: string) => (today.getTime() - new Date(s).getTime()) / 86_400_000;

  return {
    count: deals.length,
    totalPipeline: sum(deals, (d) => d.amount),
    activePipeline,
    forecast,
    wonAmount: sum(deals.filter((d) => d.status === "won"), (d) => d.amount),
    avgProbability: live.length ? Math.round(sum(live, (d) => d.effective_probability) / live.length) : 0,
    weightedConcretion: activePipeline > 0 ? Math.round((forecast / activePipeline) * 1000) / 10 : 0,
    highProbPipeline: sum(live.filter((d) => d.effective_probability >= 70), (d) => d.amount),
    nextCloseValue: sum(
      live.filter((d) => d.expected_close && daysTo(d.expected_close) >= 0 && daysTo(d.expected_close) <= 30),
      (d) => d.amount
    ),
    overdueCount: overdue.length,
    overdueAmount: sum(overdue, (d) => d.amount),
    noActionCount: live.filter((d) => d.modified_src && daysSince(d.modified_src) >= 21).length,
    bands,
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
