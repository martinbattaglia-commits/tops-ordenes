"use client";

import { useMemo } from "react";
import { useTableroFilters } from "@/hooks/useTableroFilters";
import { stalenessDays, isLiveOpportunity } from "@/lib/comercial/commercial-score";
import type { Kpis, ForecastPeriod, DataQualityReport } from "@/lib/comercial/dashboard-kpis";
import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";
import type { ActionItem } from "@/lib/comercial/dashboard-insights";

// ─── Formatters ──────────────────────────────────────────────────────────────

const fmt = (n: number): string => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000)
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  return "$ " + v.toLocaleString("es-AR");
};

const fmtPct = (n: number): string => Math.round(n) + "%";

// ─── Severity icon (text-based, no external lib) ─────────────────────────────

function SeverityDot({ priority }: { priority: ActionItem["priority"] }) {
  const color =
    priority === "critica"
      ? "bg-status-danger"
      : priority === "atencion"
      ? "bg-status-warning"
      : "bg-fg-muted";
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1.5 ${color}`} />;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface VistaDireccionProps {
  kpis: Kpis;
  deals: EnrichedDeal[];
  forecastPeriods: ForecastPeriod[];
  actions: ActionItem[];
  dataQuality: DataQualityReport;
}

// ─── Column 1: ¿Cuánto se puede cerrar? ──────────────────────────────────────

function ColCuantoCerrar({
  forecastPeriods,
  deals,
  applyFilter,
}: {
  forecastPeriods: ForecastPeriod[];
  deals: EnrichedDeal[];
  applyFilter: (partial: Parameters<ReturnType<typeof useTableroFilters>["applyFilter"]>[0]) => void;
}) {
  const period30 = forecastPeriods[0] ?? null;

  const top3 = useMemo(() => {
    const today = new Date();
    if (!period30) return [];
    const cutoff = today.getTime() + period30.days * 86_400_000;
    return deals
      .filter((d) => {
        if (!isLiveOpportunity(d)) return false;
        if (!d.expected_close) return false;
        const closeTs = new Date(d.expected_close + "T12:00:00").getTime();
        return closeTs >= today.getTime() && closeTs <= cutoff;
      })
      .sort(
        (a, b) =>
          (b.amount * b.effective_probability) / 100 -
          (a.amount * a.effective_probability) / 100
      )
      .slice(0, 3);
  }, [deals, period30]);

  return (
    <div className="card card-pad flex flex-col gap-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1">
          ¿Cuánto se puede cerrar?
        </div>
        <div className="text-xs text-fg-muted">Próximos 30 días</div>
      </div>

      {/* Forecast ponderado */}
      <div>
        <div className="text-3xl font-bold text-fg-primary tabular-nums">
          {period30 ? fmt(period30.weightedAmount) : "N/D"}
        </div>
        <div className="text-xs text-fg-muted mt-0.5">forecast ponderado · {period30?.count ?? 0} oportunidades</div>
      </div>

      {/* Top 3 */}
      {top3.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
            Top calientes
          </div>
          {top3.map((d) => (
            <a
              key={d.deal_id}
              href={d.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded-lg border border-stroke-soft px-3 py-2 hover:bg-fg-primary/5 transition-colors group"
            >
              <span className="text-sm font-medium text-fg-primary truncate group-hover:underline">
                {d.company_name ?? d.title}
              </span>
              <div className="flex items-center gap-2 shrink-0 tabular-nums text-xs">
                <span className="text-fg-secondary">{fmt(d.amount)}</span>
                <span className="badge badge-info">{d.effective_probability}%</span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-sm text-fg-muted italic">
          Sin oportunidades en los próximos 30 días
        </p>
      )}

      {/* CTA */}
      <button
        type="button"
        onClick={() => applyFilter({ score: "hot" })}
        className="mt-auto text-xs font-medium text-fg-brand hover:underline text-left"
      >
        Ver todas las calientes →
      </button>
    </div>
  );
}

// ─── Column 2: ¿Dónde está el riesgo? ────────────────────────────────────────

function ColRiesgo({
  kpis,
  deals,
  actions,
  applyFilter,
}: {
  kpis: Kpis;
  deals: EnrichedDeal[];
  actions: ActionItem[];
  applyFilter: (partial: Parameters<ReturnType<typeof useTableroFilters>["applyFilter"]>[0]) => void;
}) {
  const top3Stagnant = useMemo(() => {
    const today = new Date();
    return deals
      .filter(isLiveOpportunity)
      .map((d) => ({ ...d, staleDays: stalenessDays(d, today) }))
      .filter((d) => d.staleDays !== Infinity)
      .sort((a, b) => b.staleDays - a.staleDays)
      .slice(0, 3);
  }, [deals]);

  const top3Actions = actions.slice(0, 3);

  return (
    <div className="card card-pad flex flex-col gap-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1">
          ¿Dónde está el riesgo?
        </div>
        <div className="text-xs text-fg-muted">Situaciones que requieren decisión</div>
      </div>

      {/* Risk badges */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => applyFilter({ no_action: true })}
          className="flex items-center gap-2 rounded-lg border border-status-danger/30 bg-status-danger/5 px-3 py-2 hover:bg-status-danger/10 transition-colors text-left group"
        >
          <span className="text-lg font-bold text-status-danger tabular-nums">
            {kpis.noActionCount}
          </span>
          <span className="text-xs text-fg-secondary group-hover:text-fg-primary transition-colors">
            sin próxima acción
          </span>
        </button>
        <button
          type="button"
          onClick={() => applyFilter({ overdue: true })}
          className="flex items-center gap-2 rounded-lg border border-status-danger/30 bg-status-danger/5 px-3 py-2 hover:bg-status-danger/10 transition-colors text-left group"
        >
          <span className="text-lg font-bold text-status-danger tabular-nums">
            {kpis.overdueCount}
          </span>
          <span className="text-xs text-fg-secondary group-hover:text-fg-primary transition-colors">
            vencidas sin respuesta
          </span>
        </button>
      </div>

      {/* Top 3 estancadas */}
      {top3Stagnant.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
            Más estancadas
          </div>
          {top3Stagnant.map((d) => (
            <a
              key={d.deal_id}
              href={d.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-fg-primary/5 transition-colors group"
            >
              <span className="text-sm text-fg-secondary truncate group-hover:text-fg-primary transition-colors">
                {d.company_name ?? d.title}
              </span>
              <span className="text-xs text-status-danger font-semibold tabular-nums shrink-0">
                {d.staleDays}d sin mov.
              </span>
            </a>
          ))}
        </div>
      )}

      {/* Acciones prioritarias */}
      {top3Actions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
            Acciones prioritarias
          </div>
          {top3Actions.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <SeverityDot priority={item.priority} />
              <div className="min-w-0">
                <span className="text-xs text-fg-secondary leading-snug">{item.accion}</span>
                {item.cliente && (
                  <span className="text-xs text-fg-muted ml-1">· {item.cliente}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Column 3: Calidad del pipeline ──────────────────────────────────────────

function ColCalidadPipeline({
  kpis,
  dataQuality,
}: {
  kpis: Kpis;
  dataQuality: DataQualityReport;
}) {
  const concretion = Math.round(kpis.weightedConcretion);
  const barColor =
    concretion >= 60
      ? "bg-status-success"
      : concretion >= 35
      ? "bg-status-warning"
      : "bg-status-danger";

  // Best pipeline by concentration (active amount)
  const topPipeline = kpis.byPipeline[0] ?? null;

  // Best source by win rate (exclude "Sin fuente")
  const bestSource = useMemo(() => {
    const src = (kpis.sourceBreakdown ?? [])
      .filter((s) => s.source !== "Sin fuente" && s.count > 0)
      .map((s) => ({ ...s, winRate: s.wonCount / s.count }))
      .sort((a, b) => b.winRate - a.winRate)[0];
    return src ?? null;
  }, [kpis.sourceBreakdown]);

  // Data quality average completeness
  const avgCompleteness = useMemo(() => {
    const fields = dataQuality?.completeness ?? [];
    if (!fields.length) return null;
    const sum = fields.reduce((a, f) => a + f.pct, 0);
    return Math.round(sum / fields.length);
  }, [dataQuality]);

  return (
    <div className="card card-pad flex flex-col gap-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1">
          Calidad del pipeline
        </div>
        <div className="text-xs text-fg-muted">Métricas de salud comercial</div>
      </div>

      {/* Gauge-style concretion */}
      <div>
        <div className="flex items-end gap-2 mb-2">
          <span className="text-3xl font-bold text-fg-primary tabular-nums">{fmtPct(concretion)}</span>
          <span className="text-xs text-fg-muted mb-1">concreción ponderada</span>
        </div>
        <div className="relative h-2.5 w-full rounded-full bg-fg-primary/10 overflow-hidden">
          <div
            className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${Math.min(concretion, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-fg-muted mt-1">
          <span>0%</span>
          <span className="text-status-danger">35%</span>
          <span className="text-status-warning">60%</span>
          <span className="text-status-success">100%</span>
        </div>
      </div>

      {/* Pipeline más concentrado */}
      <div className="flex flex-col gap-1">
        <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
          Pipeline más concentrado
        </div>
        {topPipeline ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-fg-primary truncate">{topPipeline.name}</span>
            <span className="text-xs text-fg-secondary tabular-nums shrink-0">{fmt(topPipeline.active)}</span>
          </div>
        ) : (
          <span className="text-sm text-fg-muted">—</span>
        )}
      </div>

      {/* Fuente con mejor conversión */}
      <div className="flex flex-col gap-1">
        <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
          Fuente con mejor conversión
        </div>
        {bestSource ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-fg-primary truncate">{bestSource.source}</span>
            <span className="badge badge-success shrink-0">
              {Math.round(bestSource.winRate * 100)}% ganados
            </span>
          </div>
        ) : (
          <span className="text-sm text-fg-muted">Sin datos de fuente</span>
        )}
      </div>

      {/* Calidad de datos CRM */}
      <div className="flex flex-col gap-1">
        <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
          Calidad de datos CRM
        </div>
        {avgCompleteness !== null ? (
          <div className="flex items-end gap-1.5">
            <span className="text-2xl font-bold text-fg-primary tabular-nums">{avgCompleteness}%</span>
            <span className="text-xs text-fg-muted mb-0.5">completitud promedio</span>
          </div>
        ) : (
          <span className="text-sm text-fg-muted">N/D</span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VistaDireccion({
  kpis,
  deals,
  forecastPeriods,
  actions,
  dataQuality,
}: VistaDireccionProps) {
  const { applyFilter } = useTableroFilters();

  return (
    <section id="vista-direccion" className="space-y-4">
      <header>
        <h2 className="text-xl font-bold text-fg-primary">Vista Dirección</h2>
        <p className="text-sm text-fg-muted">Todo lo que necesita saber en una pantalla</p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ColCuantoCerrar
          forecastPeriods={forecastPeriods}
          deals={deals}
          applyFilter={applyFilter}
        />
        <ColRiesgo
          kpis={kpis}
          deals={deals}
          actions={actions}
          applyFilter={applyFilter}
        />
        <ColCalidadPipeline kpis={kpis} dataQuality={dataQuality} />
      </div>
    </section>
  );
}
