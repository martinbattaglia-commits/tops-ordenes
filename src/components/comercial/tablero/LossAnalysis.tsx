"use client";

import { useMemo } from "react";
import type { EnrichedDeal, Kpis } from "@/lib/comercial/dashboard-kpis";

// ─── Formatters ──────────────────────────────────────────────────────────────

const fmt = (n: number): string => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000)
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  return "$ " + v.toLocaleString("es-AR");
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface LossAnalysisProps {
  deals: EnrichedDeal[];
  kpis: Kpis;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LossAnalysis({ deals, kpis }: LossAnalysisProps) {
  // Only render if there are lost deals
  if (kpis.lostCount === 0) return null;

  return <LossAnalysisInner deals={deals} kpis={kpis} />;
}

// ─── Inner (avoids hook call when returning null) ─────────────────────────────

function LossAnalysisInner({ deals, kpis }: LossAnalysisProps) {
  const lostDeals = useMemo(
    () => deals.filter((d) => d.status === "lost"),
    [deals]
  );

  // Stage distribution of lost deals
  const byStage = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of lostDeals) {
      const s = d.stage ?? "Sin etapa";
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([stage, count]) => ({ stage, count, pct: Math.round((count / kpis.lostCount) * 100) }))
      .sort((a, b) => b.count - a.count);
  }, [lostDeals, kpis.lostCount]);

  // Pipeline distribution of lost deals
  const byPipeline = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const d of lostDeals) {
      const p = d.pipeline ?? "Sin pipeline";
      const cur = map.get(p) ?? { count: 0, amount: 0 };
      map.set(p, { count: cur.count + 1, amount: cur.amount + d.amount });
    }
    return [...map.entries()]
      .map(([pipeline, v]) => ({ pipeline, ...v }))
      .sort((a, b) => b.amount - a.amount);
  }, [lostDeals]);

  // Won vs lost bar proportions
  const total = kpis.wonAmount + kpis.lostAmount;
  const wonPct = total > 0 ? Math.round((kpis.wonAmount / total) * 100) : 0;
  const lostPct = total > 0 ? Math.round((kpis.lostAmount / total) * 100) : 0;

  return (
    <section id="loss-analysis" className="space-y-3">
      <header>
        <h2 className="text-xl font-bold text-fg-primary">Análisis de pérdidas</h2>
        <p className="text-sm text-fg-muted">Oportunidades con estado perdido en el CRM</p>
      </header>

      <div className="card card-pad space-y-6">
        {/* Summary row */}
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <span className="text-3xl font-bold text-status-danger tabular-nums">
              {kpis.lostCount}
            </span>
            <span className="text-sm text-fg-muted ml-2">
              oportunidades perdidas por{" "}
              <span className="font-semibold text-fg-secondary">{fmt(kpis.lostAmount)}</span>
            </span>
          </div>
        </div>

        {/* Ganado vs perdido bar */}
        {total > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
              Ganado vs. Perdido (por importe)
            </div>
            <div className="flex rounded-full overflow-hidden h-5 text-xs font-semibold">
              {wonPct > 0 && (
                <div
                  className="flex items-center justify-center bg-status-success text-white"
                  style={{ width: `${wonPct}%` }}
                  title={`Ganado: ${fmt(kpis.wonAmount)}`}
                >
                  {wonPct >= 12 ? `${wonPct}%` : ""}
                </div>
              )}
              {lostPct > 0 && (
                <div
                  className="flex items-center justify-center bg-status-danger text-white"
                  style={{ width: `${lostPct}%` }}
                  title={`Perdido: ${fmt(kpis.lostAmount)}`}
                >
                  {lostPct >= 12 ? `${lostPct}%` : ""}
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-fg-muted">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-status-success" />
                Ganado: {fmt(kpis.wonAmount)} ({kpis.wonCount} deals)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-status-danger" />
                Perdido: {fmt(kpis.lostAmount)} ({kpis.lostCount} deals)
              </span>
            </div>
          </div>
        )}

        {/* Motivos block */}
        <div className="rounded-lg border border-stroke-soft bg-bg-surface-alt px-4 py-3 text-sm text-fg-muted">
          <span className="font-semibold text-fg-secondary">Motivos de pérdida:</span>{" "}
          Los motivos de pérdida no están disponibles en Clientify. Para activar este análisis, agrega un campo personalizado{" "}
          <em>&quot;Motivo de pérdida&quot;</em> en los deals perdidos.
        </div>

        {/* Stage distribution */}
        {byStage.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
              Distribución por etapa
            </div>
            <div className="flex flex-col gap-1.5">
              {byStage.map(({ stage, count, pct }) => (
                <div key={stage} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 truncate text-sm text-fg-secondary" title={stage}>
                    {stage}
                  </div>
                  <div className="flex-1 relative h-2 rounded-full bg-fg-primary/10 overflow-hidden">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-status-danger/50"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs tabular-nums text-fg-muted w-16 text-right">
                    {count} ({pct}%)
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pipeline distribution */}
        {byPipeline.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
              Distribución por pipeline
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-stroke-soft text-xs text-fg-muted uppercase tracking-wide">
                    <th className="py-1.5 px-2 text-left">Pipeline</th>
                    <th className="py-1.5 px-2 text-right">Deals</th>
                    <th className="py-1.5 px-2 text-right">Importe perdido</th>
                  </tr>
                </thead>
                <tbody>
                  {byPipeline.map(({ pipeline, count, amount }) => (
                    <tr
                      key={pipeline}
                      className="border-b border-stroke-soft last:border-0 hover:bg-fg-primary/5 transition-colors"
                    >
                      <td className="py-2 px-2 text-fg-secondary">{pipeline}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-fg-primary">{count}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-status-danger font-medium">
                        {fmt(amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
