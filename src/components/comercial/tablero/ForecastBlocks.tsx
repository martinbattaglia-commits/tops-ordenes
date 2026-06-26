"use client";

import { useTableroFilters, scrollToSection } from "@/hooks/useTableroFilters";
import type { ForecastPeriod } from "@/lib/comercial/dashboard-kpis";

// ─── Formatting ───────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? "$ " + (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

// ─── Period label map ─────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<ForecastPeriod["label"], string> = {
  "30d": "Próximos 30 días",
  "60d": "Próximos 60 días",
  "90d": "Próximos 90 días",
};

// ─── Single period card ───────────────────────────────────────────────────────

interface PeriodCardProps {
  period: ForecastPeriod;
  isClickable: boolean;
  onClick?: () => void;
  animDelay?: number;
}

function PeriodCard({ period, isClickable, onClick, animDelay = 0 }: PeriodCardProps) {
  const handleKey = (e: React.KeyboardEvent) => {
    if (onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };

  const isEmpty = period.count === 0;

  return (
    <div
      className={`card card-pad flex flex-col gap-3 nx-lift ${
        isClickable
          ? "cursor-pointer hover:border-fg-brand/40 transition-colors focus-visible:ring-2 focus-visible:ring-fg-brand/60 outline-none"
          : ""
      }`}
      style={{ animationDelay: `${animDelay}ms` }}
      onClick={isClickable ? onClick : undefined}
      onKeyDown={isClickable ? handleKey : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      title={isClickable ? "Haz clic para filtrar oportunidades con cierre en los próximos 30 días" : undefined}
    >
      {/* Period label */}
      <div className="text-eyebrow-sm uppercase text-fg-muted">
        {PERIOD_LABELS[period.label]}
      </div>

      {isEmpty ? (
        <p className="text-sm text-fg-muted py-4 text-center">
          Sin oportunidades en este período
        </p>
      ) : (
        <>
          {/* Main: weighted amount (the number to bet on) */}
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-fg-muted">Valor ponderado</span>
            <span className="kpi-value text-status-success">
              {fmt(period.weightedAmount)}
            </span>
          </div>

          {/* Secondary: gross amount */}
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-xs text-fg-muted">Valor bruto</span>
              <div className="text-sm font-semibold text-fg-secondary tabular-nums">
                {fmt(period.totalAmount)}
              </div>
            </div>
          </div>

          {/* Count + hot badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-fg-secondary">
              {period.count} oportunidad{period.count !== 1 ? "es" : ""}
            </span>
            {period.hotCount > 0 && (
              <span className="badge badge-success text-xs">
                {period.hotCount} caliente{period.hotCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Avg probability */}
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="text-fg-secondary font-medium">{period.avgProbability}%</span>
            <span>prob. promedio</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ForecastBlocksProps {
  periods: ForecastPeriod[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ForecastBlocks({ periods }: ForecastBlocksProps) {
  const { applyFilter } = useTableroFilters();

  const handle30dClick = () => {
    applyFilter({ closing_30: true });
    scrollToSection("opportunities-table");
  };

  return (
    <section className="flex flex-col gap-3 md:gap-4">
      {/* Header */}
      <div className="flex items-baseline gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Forecast comercial
        </p>
        <span className="text-eyebrow-sm text-fg-muted">
          Oportunidades con fecha estimada de cierre
        </span>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 nx-stagger">
        {periods.map((period, idx) => (
          <PeriodCard
            key={period.label}
            period={period}
            isClickable={period.label === "30d" && period.count > 0}
            onClick={period.label === "30d" && period.count > 0 ? handle30dClick : undefined}
            animDelay={idx * 60}
          />
        ))}
      </div>
    </section>
  );
}
