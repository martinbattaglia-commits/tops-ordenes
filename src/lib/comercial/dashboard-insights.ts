import type { EnrichedDeal, Kpis, ForecastPeriod, SourceStats, FunnelStage, DataQualityReport, DataQualityField } from "./dashboard-kpis";
import { isLive } from "./dashboard-kpis";
import {
  isLiveOpportunity, isExpiredOpportunity, calculateWeightedForecast,
  calculateCommercialScore, getOpportunityPriority, getOpportunityAlert,
  getSuggestedAction, hasSuspiciousAmount, type Severity, type PriorityQuadrant,
} from "./commercial-score";

export interface BusinessUnit { name: string; amount: number; pct: number; count: number; forecast: number; avgProb: number; }
export interface StageRow { stage: string; count: number; amount: number; forecast: number; pct: number; }
export interface QuadrantGroup { key: PriorityQuadrant; label: string; count: number; amount: number; deals: EnrichedDeal[]; }
export interface Insight { text: string; tone: "info" | "warning" | "danger" | "success"; }
export interface ActionItem { priority: Severity; cliente: string; motivo: string; impacto: number; accion: string; href: string; }
export interface AlertGroup { severity: Severity; items: { cliente: string; label: string; href: string; amount: number }[]; }

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const live = (ds: EnrichedDeal[]) => ds.filter(isLiveOpportunity);

/** Mediana del importe de las vivas — umbral de "importe alto" para la matriz. */
export function liveAmountSplit(deals: EnrichedDeal[]): number {
  const xs = live(deals).map((d) => d.amount).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function groupByBusinessUnit(deals: EnrichedDeal[]): BusinessUnit[] {
  const ls = live(deals);
  const total = sum(ls.map((d) => d.amount)) || 1;
  const byName = new Map<string, EnrichedDeal[]>();
  for (const d of ls) {
    const n = d.pipeline ?? "Otros";
    byName.set(n, [...(byName.get(n) ?? []), d]);
  }
  return [...byName.entries()]
    .map(([name, ds]) => {
      const amount = sum(ds.map((d) => d.amount));
      return {
        name, amount, count: ds.length,
        pct: Math.round((amount / total) * 100),
        forecast: Math.round(sum(ds.map(calculateWeightedForecast))),
        avgProb: ds.length ? Math.round(sum(ds.map((d) => d.effective_probability)) / ds.length) : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export function groupByStage(deals: EnrichedDeal[]): StageRow[] {
  const ls = live(deals);
  const total = ls.length || 1;
  const byStage = new Map<string, EnrichedDeal[]>();
  for (const d of ls) {
    const s = d.stage ?? "—";
    byStage.set(s, [...(byStage.get(s) ?? []), d]);
  }
  return [...byStage.entries()]
    .map(([stage, ds]) => ({
      stage, count: ds.length,
      amount: sum(ds.map((d) => d.amount)),
      forecast: Math.round(sum(ds.map(calculateWeightedForecast))),
      pct: Math.round((ds.length / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

const QUADRANTS: { key: PriorityQuadrant; label: string }[] = [
  { key: "alta_prioridad", label: "Alta prioridad" },
  { key: "quick_win", label: "Quick wins" },
  { key: "a_trabajar", label: "A trabajar" },
  { key: "baja_prioridad", label: "Baja prioridad" },
];

export function groupByPriorityQuadrant(deals: EnrichedDeal[], today: Date): QuadrantGroup[] {
  const split = liveAmountSplit(deals);
  const ls = live(deals);
  return QUADRANTS.map(({ key, label }) => {
    const ds = ls
      .filter((d) => getOpportunityPriority(d, split) === key)
      .sort((a, b) => calculateCommercialScore(b, today) - calculateCommercialScore(a, today));
    return { key, label, count: ds.length, amount: sum(ds.map((d) => d.amount)), deals: ds };
  });
}

/** Top oportunidades a cerrar, ordenadas por score comercial. */
export function topOpportunities(deals: EnrichedDeal[], today: Date, n = 6): EnrichedDeal[] {
  return live(deals)
    .map((d) => ({ d, s: calculateCommercialScore(d, today) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.d);
}

/** Insights por reglas a partir de datos reales del tablero. */
export function generateCommercialInsights(deals: EnrichedDeal[], kpis: Kpis): Insight[] {
  const out: Insight[] = [];
  const ls = live(deals);
  const units = groupByBusinessUnit(deals);
  const totalActive = kpis.activePipeline || 1;

  if (units[0]) {
    out.push({ tone: "info", text: `El ${units[0].pct}% del pipeline vivo está concentrado en ${units[0].name}.` });
  }
  // Top-3 por forecast ponderado vs total
  const fcs = ls.map(calculateWeightedForecast).sort((a, b) => b - a);
  const top3 = sum(fcs.slice(0, 3));
  if (kpis.forecast > 0) {
    out.push({ tone: "info", text: `Las 3 principales oportunidades explican el ${Math.round((top3 / kpis.forecast) * 100)}% del forecast ponderado.` });
  }
  // Vencidas (expired) fuera del pipeline
  const expired = deals.filter(isExpiredOpportunity);
  if (expired.length) {
    out.push({ tone: "warning", text: `Hay ${expired.length} oportunidades vencidas fuera del pipeline activo ($ ${Math.round(sum(expired.map((d) => d.amount))).toLocaleString("es-AR")}).` });
  }
  // Mejor probabilidad promedio por unidad (con al menos 2 deals)
  const best = [...units].filter((u) => u.count >= 2).sort((a, b) => b.avgProb - a.avgProb)[0];
  const biggest = units[0];
  if (best && biggest && best.name !== biggest.name) {
    out.push({ tone: "success", text: `${best.name} tiene menor volumen pero la mejor probabilidad promedio (${best.avgProb}%).` });
  }
  // Alto valor sin horizonte
  const noHor = ls.filter((d) => d.amount >= 1_000_000 && (!d.overlay_horizonte || d.overlay_horizonte === "A definir"));
  if (noHor.length) {
    out.push({ tone: "warning", text: `Hay ${noHor.length} oportunidades de alto valor sin horizonte definido.` });
  }
  // Importes sospechosos
  const sus = ls.filter(hasSuspiciousAmount);
  if (sus.length) {
    out.push({ tone: "danger", text: `${sus.length} oportunidad${sus.length === 1 ? "" : "es"} con importe sospechoso ($1): revisar carga en Clientify.` });
  }
  // Vencidas dentro de las vivas
  if (kpis.overdueCount > 0) {
    out.push({ tone: "danger", text: `${kpis.overdueCount} oportunidades activas tienen el cierre estimado vencido (${Math.round((kpis.overdueAmount / totalActive) * 100)}% del pipeline vivo).` });
  }
  return out;
}

const SEV_RANK: Record<Severity, number> = { critica: 0, atencion: 1, informativa: 2 };

/** Alertas comerciales agrupadas por severidad. */
export function buildAlertGroups(deals: EnrichedDeal[], today: Date): AlertGroup[] {
  const groups: Record<Severity, AlertGroup["items"]> = { critica: [], atencion: [], informativa: [] };
  for (const d of deals) {
    if (!isLiveOpportunity(d) && !isExpiredOpportunity(d)) continue;
    const a = getOpportunityAlert(d, today);
    if (!a) continue;
    groups[a.severity].push({ cliente: d.title, label: a.label, href: d.href, amount: d.amount });
  }
  return (["critica", "atencion", "informativa"] as Severity[])
    .map((severity) => ({ severity, items: groups[severity].sort((x, y) => y.amount - x.amount) }))
    .filter((g) => g.items.length);
}

/** Plan de acción sugerido: top acciones por severidad e impacto. */
export function generateSuggestedActions(deals: EnrichedDeal[], today: Date, n = 5): ActionItem[] {
  const items: ActionItem[] = [];
  for (const d of deals) {
    if (!isLiveOpportunity(d) && !isExpiredOpportunity(d)) continue;
    const alert = getOpportunityAlert(d, today);
    const priority: Severity = alert?.severity ?? "informativa";
    items.push({
      priority,
      cliente: d.title,
      motivo: alert?.label ?? "Oportunidad activa relevante",
      impacto: Math.round(calculateWeightedForecast(d)),
      accion: getSuggestedAction(d, today),
      href: d.href,
    });
  }
  return items
    .sort((a, b) => SEV_RANK[a.priority] - SEV_RANK[b.priority] || b.impacto - a.impacto)
    .slice(0, n);
}

const sumArr = (xs: EnrichedDeal[], f: (d: EnrichedDeal) => number): number =>
  xs.reduce((a, d) => a + f(d), 0);

const wf = (d: EnrichedDeal): number => (d.amount * d.effective_probability) / 100;

const daysToDate = (s: string, today: Date): number =>
  (new Date(s + "T12:00:00").getTime() - today.getTime()) / 86_400_000;

export function getForecastByPeriod(deals: EnrichedDeal[], today: Date): ForecastPeriod[] {
  const ls = deals.filter(isLive);
  const periods: Array<{ label: ForecastPeriod["label"]; days: number }> = [
    { label: "30d", days: 30 },
    { label: "60d", days: 60 },
    { label: "90d", days: 90 },
  ];
  return periods.map(({ label, days }) => {
    const bucket = ls.filter((d) => {
      if (!d.expected_close) return false;
      const dt = daysToDate(d.expected_close, today);
      return dt >= 0 && dt <= days;
    });
    const totalAmount = sumArr(bucket, (d) => d.amount);
    const weightedAmount = sumArr(bucket, wf);
    return {
      label,
      days,
      count: bucket.length,
      hotCount: bucket.filter((d) => d.effective_probability >= 60).length,
      totalAmount,
      weightedAmount,
      avgProbability: bucket.length
        ? Math.round(sumArr(bucket, (d) => d.effective_probability) / bucket.length)
        : 0,
    };
  });
}

export function getFunnelData(deals: EnrichedDeal[]): FunnelStage[] {
  const ls = deals.filter(isLive);
  const byStage = new Map<string, EnrichedDeal[]>();
  for (const d of ls) {
    const s = d.stage ?? "—";
    byStage.set(s, [...(byStage.get(s) ?? []), d]);
  }
  const stages = [...byStage.entries()]
    .map(([stage, ds]) => ({
      stage,
      count: ds.length,
      totalAmount: sumArr(ds, (d) => d.amount),
      weightedAmount: sumArr(ds, wf),
      avgProb: ds.length ? sumArr(ds, (d) => d.effective_probability) / ds.length : 0,
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

export function groupBySource(deals: EnrichedDeal[]): SourceStats[] {
  const bySource = new Map<string, EnrichedDeal[]>();
  for (const d of deals) {
    const key = d.deal_source ?? "Sin fuente";
    bySource.set(key, [...(bySource.get(key) ?? []), d]);
  }
  return [...bySource.entries()]
    .map(([source, ds]) => {
      const ls = ds.filter(isLive);
      const totalAmount = sumArr(ls, (d) => d.amount);
      const weightedAmount = sumArr(ls, wf);
      return {
        source,
        count: ls.length,
        totalAmount,
        weightedAmount,
        wonCount: ds.filter((d) => d.status === "won").length,
        lostCount: ds.filter((d) => d.status === "lost").length,
        avgProbability: ls.length
          ? Math.round(sumArr(ls, (d) => d.effective_probability) / ls.length)
          : 0,
        ticketAvg: ls.length ? Math.round(totalAmount / ls.length) : 0,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

const QUALITY_FIELDS: Array<{ field: string; label: string; check: (d: EnrichedDeal) => boolean }> = [
  { field: "amount",               label: "Importe",         check: (d) => d.amount > 1 },
  { field: "effective_probability", label: "Probabilidad",   check: (d) => d.effective_probability > 0 },
  { field: "expected_close",       label: "Fecha de cierre", check: (d) => Boolean(d.expected_close) },
  { field: "owner_name",           label: "Responsable",     check: (d) => Boolean(d.owner_name) },
  { field: "company_name",         label: "Empresa",         check: (d) => Boolean(d.company_name) },
  { field: "contact_name",         label: "Contacto",        check: (d) => Boolean(d.contact_name) },
  { field: "deal_source",          label: "Fuente / Origen", check: (d) => Boolean(d.deal_source) },
];

function scoreLabel(score: number): DataQualityReport["scoreLabel"] {
  if (score >= 85) return "excelente";
  if (score >= 65) return "bueno";
  if (score >= 40) return "regular";
  return "critico";
}

export function getDataQuality(deals: EnrichedDeal[]): DataQualityReport {
  const ls = deals.filter(isLive);
  const total = ls.length;
  const completeness: DataQualityField[] = QUALITY_FIELDS.map(({ field, label, check }) => {
    const filled = ls.filter(check).length;
    return { field, label, filled, pct: total ? Math.round((filled / total) * 100) : 0 };
  });
  const score = total === 0 ? 0 : Math.round(
    ls.reduce((sum, d) => {
      const filled = QUALITY_FIELDS.filter(({ check }) => check(d)).length;
      return sum + (filled / QUALITY_FIELDS.length) * 100;
    }, 0) / total
  );
  const incomplete = ls
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

export function getStagnantDeals(deals: EnrichedDeal[], today: Date, days = 14): EnrichedDeal[] {
  return deals.filter(isLive).filter((d) => {
    if (!d.modified_src) return false;
    return (today.getTime() - new Date(d.modified_src).getTime()) / 86_400_000 >= days;
  });
}
