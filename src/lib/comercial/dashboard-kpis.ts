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
  actual_close: string | null;
  modified_src: string | null;
  href: string;
  effective_probability: number;
  overlay_horizonte: string | null;
  overlay_observaciones: string | null;
  deal_source: string | null;
  stale_days?: number;
  is_overdue?: boolean;
}

export interface ProbBand {
  key: "alta" | "media" | "baja";
  label: string;
  count: number;
  amount: number;    // Σ amount del pipeline vivo en la banda
  forecast: number;  // Σ amount*prob/100 en la banda
}

export interface ForecastPeriod {
  label: "30d" | "60d" | "90d";
  days: number;
  count: number;
  hotCount: number;             // count with effective_probability >= 60
  totalAmount: number;
  weightedAmount: number;       // Σ amount * prob/100
  avgProbability: number;
}

export interface SourceStats {
  source: string;               // "Sin fuente" if null
  count: number;
  totalAmount: number;
  weightedAmount: number;
  wonCount: number;
  lostCount: number;
  avgProbability: number;
  ticketAvg: number;
}

export interface FunnelStage {
  stage: string;
  count: number;
  totalAmount: number;
  weightedAmount: number;
  conversionRate: number | null; // % that advance to next stage (null if last)
  dropRate: number | null;       // % that are lost or stagnant here (null if no data)
  avgDaysInStage: number | null; // null when no expected_close data
}

export interface DataQualityReport {
  total: number;
  completeness: DataQualityField[];
  incomplete: { deal_id: number; title: string; missing: string[]; href: string }[];
  score: number;      // 0-100
  scoreLabel: "excelente" | "bueno" | "regular" | "critico";
}

export interface DataQualityField {
  field: string;
  label: string;
  filled: number;
  pct: number;
}

export interface Kpis {
  count: number;               // total de oportunidades visibles (incluye vencidas/ganadas/perdidas)
  liveCount: number;           // oportunidades vivas (open/other) — las que realmente cuentan
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
  stagnantCount: number;       // live + stale_days >= 14
  lostCount: number;           // count of lost deals
  lostAmount: number;          // Σ amount of lost deals
  wonCount: number;            // count of won deals
  forecastByPeriod: ForecastPeriod[]; // 30/60/90d buckets
  sourceBreakdown: SourceStats[];     // per deal_source stats
  funnelData: FunnelStage[];          // ordered stages with conversion
  dataQuality: DataQualityReport;     // field completeness
  bands: ProbBand[];           // pipeline vivo por banda de prob. (alta/media/baja)
  byPipeline: { id: number; name: string; active: number; forecast: number; count: number }[];
}

export interface Alert { kind: "overdue" | "stale" | "lowprob"; label: string; }

export const isLive = (d: EnrichedDeal) => d.status === "open" || d.status === "other";
const STALE_DAYS = 21;

function sumDeals(xs: EnrichedDeal[], f: (d: EnrichedDeal) => number): number {
  return xs.reduce((a, d) => a + f(d), 0);
}

function fc(d: EnrichedDeal): number {
  return (d.amount * d.effective_probability) / 100;
}

function daysSince(s: string, today: Date): number {
  return (today.getTime() - new Date(s).getTime()) / 86_400_000;
}

function daysTo(s: string, today: Date): number {
  return (new Date(s + "T12:00:00").getTime() - today.getTime()) / 86_400_000;
}

function computeForecastByPeriod(deals: EnrichedDeal[], today: Date): ForecastPeriod[] {
  const live = deals.filter(isLive);
  const periods: Array<{ label: ForecastPeriod["label"]; days: number }> = [
    { label: "30d", days: 30 },
    { label: "60d", days: 60 },
    { label: "90d", days: 90 },
  ];
  return periods.map(({ label, days }) => {
    const bucket = live.filter((d) => {
      if (!d.expected_close) return false;
      const dt = daysTo(d.expected_close, today);
      return dt >= 0 && dt <= days;
    });
    const totalAmount = sumDeals(bucket, (d) => d.amount);
    const weightedAmount = sumDeals(bucket, fc);
    return {
      label,
      days,
      count: bucket.length,
      hotCount: bucket.filter((d) => d.effective_probability >= 60).length,
      totalAmount,
      weightedAmount,
      avgProbability: bucket.length
        ? Math.round(sumDeals(bucket, (d) => d.effective_probability) / bucket.length)
        : 0,
    };
  });
}

function computeFunnelData(deals: EnrichedDeal[]): FunnelStage[] {
  const live = deals.filter(isLive);
  const byStage = new Map<string, EnrichedDeal[]>();
  for (const d of live) {
    const s = d.stage ?? "—";
    byStage.set(s, [...(byStage.get(s) ?? []), d]);
  }
  const stages = [...byStage.entries()]
    .map(([stage, ds]) => ({
      stage,
      count: ds.length,
      totalAmount: sumDeals(ds, (d) => d.amount),
      weightedAmount: sumDeals(ds, fc),
      avgProb: ds.length ? sumDeals(ds, (d) => d.effective_probability) / ds.length : 0,
    }))
    .sort((a, b) => a.avgProb - b.avgProb);

  return stages.map((s, i) => {
    const next = stages[i + 1];
    return {
      stage: s.stage,
      count: s.count,
      totalAmount: s.totalAmount,
      weightedAmount: s.weightedAmount,
      conversionRate: next ? (next.count / s.count) * 100 : null,
      dropRate: null,
      avgDaysInStage: null,
    };
  });
}

function computeGroupBySource(deals: EnrichedDeal[]): SourceStats[] {
  const bySource = new Map<string, EnrichedDeal[]>();
  for (const d of deals) {
    const key = d.deal_source ?? "Sin fuente";
    bySource.set(key, [...(bySource.get(key) ?? []), d]);
  }
  return [...bySource.entries()]
    .map(([source, ds]) => {
      const live = ds.filter(isLive);
      const totalAmount = sumDeals(live, (d) => d.amount);
      const weightedAmount = sumDeals(live, fc);
      return {
        source,
        count: live.length,
        totalAmount,
        weightedAmount,
        wonCount: ds.filter((d) => d.status === "won").length,
        lostCount: ds.filter((d) => d.status === "lost").length,
        avgProbability: live.length
          ? Math.round(sumDeals(live, (d) => d.effective_probability) / live.length)
          : 0,
        ticketAvg: live.length ? Math.round(totalAmount / live.length) : 0,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

// Campos de calidad: solo campos que vienen de Clientify (no overlays internos de Nexus).
// overlay_horizonte fue removido: es un campo interno de Nexus, su ausencia no indica
// dato faltante en el CRM y distorsiona el score.
const QUALITY_FIELDS: Array<{ field: keyof EnrichedDeal; label: string; check: (d: EnrichedDeal) => boolean }> = [
  { field: "amount",               label: "Importe",          check: (d) => d.amount > 1 },
  { field: "effective_probability", label: "Probabilidad",    check: (d) => d.effective_probability > 0 },
  { field: "expected_close",       label: "Fecha de cierre",  check: (d) => Boolean(d.expected_close) },
  { field: "owner_name",           label: "Responsable",      check: (d) => Boolean(d.owner_name) },
  { field: "company_name",         label: "Empresa",          check: (d) => Boolean(d.company_name) },
  { field: "contact_name",         label: "Contacto",         check: (d) => Boolean(d.contact_name) },
  { field: "deal_source",          label: "Fuente / Origen",  check: (d) => Boolean(d.deal_source) },
];

function scoreLabel(score: number): DataQualityReport["scoreLabel"] {
  if (score >= 85) return "excelente";
  if (score >= 65) return "bueno";
  if (score >= 40) return "regular";
  return "critico";
}

function computeDataQuality(deals: EnrichedDeal[]): DataQualityReport {
  const live = deals.filter(isLive);
  const total = live.length;
  const completeness: DataQualityField[] = QUALITY_FIELDS.map(({ field, label, check }) => {
    const filled = live.filter(check).length;
    return { field: field as string, label, filled, pct: total ? Math.round((filled / total) * 100) : 0 };
  });
  // Score = media de completitud por oportunidad (no por campo)
  const score = total === 0 ? 0 : Math.round(
    live.reduce((sum, d) => {
      const filled = QUALITY_FIELDS.filter(({ check }) => check(d)).length;
      return sum + (filled / QUALITY_FIELDS.length) * 100;
    }, 0) / total
  );
  const incomplete = live
    .map((d) => ({
      deal_id: d.deal_id,
      title: d.title,
      href: d.href,
      missing: QUALITY_FIELDS.filter(({ check }) => !check(d)).map(({ label }) => label),
    }))
    .filter((d) => d.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length)
    .slice(0, 20);
  return { total, completeness, incomplete, score, scoreLabel: scoreLabel(score) };
}

export function computeKpis(deals: EnrichedDeal[], today: Date): Kpis {
  const live = deals.filter(isLive);
  const sum = sumDeals;

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

  const stagnantCount = live.filter(
    (d) => d.modified_src && daysSince(d.modified_src, today) >= 14
  ).length;

  const lost = deals.filter((d) => d.status === "lost");

  return {
    count: deals.length,
    liveCount: live.length,
    totalPipeline: sum(deals, (d) => d.amount),
    activePipeline,
    forecast,
    wonAmount: sum(deals.filter((d) => d.status === "won"), (d) => d.amount),
    avgProbability: live.length ? Math.round(sum(live, (d) => d.effective_probability) / live.length) : 0,
    weightedConcretion: activePipeline > 0 ? Math.round((forecast / activePipeline) * 1000) / 10 : 0,
    highProbPipeline: sum(live.filter((d) => d.effective_probability >= 70), (d) => d.amount),
    nextCloseValue: sum(
      live.filter((d) => d.expected_close && daysTo(d.expected_close, today) >= 0 && daysTo(d.expected_close, today) <= 30),
      (d) => d.amount
    ),
    overdueCount: overdue.length,
    overdueAmount: sum(overdue, (d) => d.amount),
    noActionCount: live.filter((d) => d.modified_src && daysSince(d.modified_src, today) >= 21).length,
    stagnantCount,
    lostCount: lost.length,
    lostAmount: sum(lost, (d) => d.amount),
    wonCount: deals.filter((d) => d.status === "won").length,
    forecastByPeriod: computeForecastByPeriod(deals, today),
    sourceBreakdown: computeGroupBySource(deals),
    funnelData: computeFunnelData(deals),
    dataQuality: computeDataQuality(deals),
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
