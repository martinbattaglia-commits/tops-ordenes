"use client";

import { useMemo } from "react";
import type { FunnelStage } from "@/lib/comercial/dashboard-kpis";
import { useTableroFilters, scrollToSection } from "@/hooks/useTableroFilters";

// ─── fmt helper ──────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000)
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  return "$ " + v.toLocaleString("es-AR");
};

// ─── Bar color palette ────────────────────────────────────────────────────────
// Ordered from earliest stage (blue) to latest (green)

const BAR_COLORS = [
  "bg-blue-500/70",
  "bg-indigo-500/70",
  "bg-violet-500/70",
  "bg-purple-500/70",
  "bg-green-500/70",
];

function barColor(index: number, total: number): string {
  if (total <= 1) return BAR_COLORS[BAR_COLORS.length - 1];
  const ratio = index / Math.max(total - 1, 1);
  const idx = Math.min(Math.round(ratio * (BAR_COLORS.length - 1)), BAR_COLORS.length - 1);
  return BAR_COLORS[idx];
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  stages: FunnelStage[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FunnelAnalysis({ stages }: Props) {
  const { applyFilter } = useTableroFilters();

  const maxCount = useMemo(() => Math.max(...stages.map((s) => s.count), 1), [stages]);

  // Auto-insights from stage data
  const insights = useMemo<string[]>(() => {
    const out: string[] = [];
    if (!stages.length) return out;

    // 1. Largest concentration
    const biggest = stages.reduce((a, b) => (a.count > b.count ? a : b));
    out.push(
      `Mayor concentración de oportunidades: ${biggest.stage} (${biggest.count} deal${biggest.count === 1 ? "" : "s"}, ${fmt(biggest.totalAmount)})`
    );

    // 2. Worst conversion drop (lowest conversionRate between stages)
    const withConversion = stages.filter((s) => s.conversionRate !== null);
    if (withConversion.length > 0) {
      const worst = withConversion.reduce((a, b) =>
        (a.conversionRate ?? 100) < (b.conversionRate ?? 100) ? a : b
      );
      const idx = stages.findIndex((s) => s.stage === worst.stage);
      const next = stages[idx + 1];
      if (next && worst.conversionRate !== null) {
        const dropPct = Math.round((1 - worst.conversionRate / 100) * 100);
        out.push(
          `Mayor caída entre "${worst.stage}" → "${next.stage}" (${dropPct}% de abandono)`
        );
      }
    }

    // 3. Most populated stage count
    const topStage = stages[0];
    if (topStage && stages.length > 1) {
      out.push(
        `${topStage.count} oportunidad${topStage.count === 1 ? "" : "es"} en la etapa más poblada: ${topStage.stage}`
      );
    }

    return out;
  }, [stages]);

  if (!stages.length) {
    return (
      <section className="space-y-4">
        <header>
          <h2 className="text-xl font-bold text-fg-primary">Embudo comercial</h2>
          <p className="text-sm text-fg-muted">Distribución de oportunidades por etapa</p>
        </header>
        <div className="card card-pad">
          <p className="text-sm text-fg-muted">
            Sin datos de embudo. Agrega etapas en Clientify para ver la distribución.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-bold text-fg-primary">Embudo comercial</h2>
        <p className="text-sm text-fg-muted">Distribución de oportunidades por etapa</p>
      </header>

      <div className="card card-pad space-y-4">
        {/* Stage bars */}
        <div className="space-y-2">
          {stages.map((s, i) => {
            const widthPct = Math.max(Math.round((s.count / maxCount) * 100), 4);
            const color = barColor(i, stages.length);
            const tipParts = [
              `${s.count} deal${s.count === 1 ? "" : "s"}`,
              fmt(s.totalAmount),
              s.conversionRate !== null
                ? `→ ${Math.round(s.conversionRate)}% pasan a la siguiente etapa`
                : "última etapa",
            ];
            const tipText = tipParts.join(" · ");

            return (
              <div key={s.stage} className="flex items-center gap-3 group">
                {/* Stage name */}
                <div className="w-32 shrink-0 text-xs text-fg-secondary font-medium truncate text-right">
                  {s.stage}
                </div>

                {/* Bar (clickable) */}
                <button
                  type="button"
                  className="flex-1 flex items-center gap-2 cursor-pointer"
                  title={tipText}
                  onClick={() => {
                    applyFilter({ stage: s.stage });
                    scrollToSection("opportunities-table");
                  }}
                >
                  <div className="flex-1 h-6 bg-bg-surface-alt rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${color} transition-all duration-300 group-hover:brightness-110`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </button>

                {/* Stats */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Count badge */}
                  <span className="text-xs font-semibold text-fg-primary tabular-nums w-6 text-right">
                    {s.count}
                  </span>

                  {/* Total amount */}
                  <span className="text-xs text-fg-secondary tabular-nums hidden sm:inline w-20 text-right">
                    {fmt(s.totalAmount)}
                  </span>

                  {/* Weighted amount */}
                  <span className="text-xs text-fg-muted tabular-nums hidden md:inline w-20 text-right">
                    <span className="text-fg-muted/60">esp.</span>{" "}
                    {fmt(s.weightedAmount)}
                  </span>

                  {/* Conversion rate to next stage */}
                  {s.conversionRate !== null ? (
                    <span className="text-xs font-medium text-fg-brand hidden sm:inline w-12 text-right tabular-nums">
                      → {Math.round(s.conversionRate)}%
                    </span>
                  ) : (
                    <span className="hidden sm:inline w-12" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend row */}
        <div className="flex items-center gap-4 text-xs text-fg-muted border-t border-stroke-soft pt-3">
          <span className="font-medium">Click en una barra para filtrar oportunidades por etapa</span>
          <span className="ml-auto hidden sm:flex items-center gap-3">
            <span>Cant.</span>
            <span className="hidden sm:inline w-20 text-right">Total</span>
            <span className="hidden md:inline w-20 text-right">Esp.</span>
            <span className="hidden sm:inline w-12 text-right">Conv.</span>
          </span>
        </div>

        {/* Auto-insights */}
        {insights.length > 0 && (
          <div className="border-t border-stroke-soft pt-3 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-2">
              Insights automáticos
            </p>
            <ul className="space-y-1">
              {insights.map((text, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-fg-secondary">
                  <span className="text-fg-brand shrink-0 mt-0.5 font-bold">→</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
