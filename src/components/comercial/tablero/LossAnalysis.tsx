"use client";

import { useMemo } from "react";
import type { EnrichedDeal, Kpis } from "@/lib/comercial/dashboard-kpis";

const fmt = (n: number): string => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000)
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  return "$ " + v.toLocaleString("es-AR");
};

interface LossAnalysisProps {
  deals: EnrichedDeal[];
  kpis: Kpis;
}

export function LossAnalysis({ deals, kpis }: LossAnalysisProps) {
  if (kpis.lostCount === 0) return null;
  return <LossAnalysisInner deals={deals} kpis={kpis} />;
}

function LossAnalysisInner({ deals, kpis }: LossAnalysisProps) {
  const lostDeals = useMemo(() => deals.filter((d) => d.status === "lost"), [deals]);

  // Stage distribution
  const byStage = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const d of lostDeals) {
      const s = d.stage ?? "Sin etapa";
      const cur = map.get(s) ?? { count: 0, amount: 0 };
      map.set(s, { count: cur.count + 1, amount: cur.amount + d.amount });
    }
    return [...map.entries()]
      .map(([stage, v]) => ({ stage, ...v, pct: Math.round((v.count / kpis.lostCount) * 100) }))
      .sort((a, b) => b.count - a.count);
  }, [lostDeals, kpis.lostCount]);

  // Monthly trend using actual_close
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const d of lostDeals) {
      const dateStr = d.actual_close ?? d.modified_src;
      if (!dateStr) continue;
      const month = dateStr.slice(0, 7); // YYYY-MM
      const cur = map.get(month) ?? { count: 0, amount: 0 };
      map.set(month, { count: cur.count + 1, amount: cur.amount + d.amount });
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6) // últimos 6 meses
      .map(([month, v]) => ({
        month: new Date(month + "-01").toLocaleDateString("es-AR", { month: "short", year: "2-digit" }),
        ...v,
      }));
  }, [lostDeals]);

  const maxMonthCount = Math.max(...monthlyTrend.map((m) => m.count), 1);

  // Pipeline distribution
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

  const total = kpis.wonAmount + kpis.lostAmount;
  const wonPct = total > 0 ? Math.round((kpis.wonAmount / total) * 100) : 0;
  const lostPct = total > 0 ? Math.round((kpis.lostAmount / total) * 100) : 0;
  const ticketAvg = kpis.lostCount > 0 ? kpis.lostAmount / kpis.lostCount : 0;

  return (
    <section id="loss-analysis" className="space-y-3">
      <header>
        <h2 className="text-xl font-bold text-fg-primary">Análisis de pérdidas</h2>
        <p className="text-sm text-fg-muted">
          {kpis.lostCount} oportunidades perdidas · {fmt(kpis.lostAmount)} en importe total ·
          ticket promedio {fmt(ticketAvg)}
        </p>
      </header>

      <div className="card card-pad space-y-6">
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

        {/* Monthly trend */}
        {monthlyTrend.length > 1 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
              Evolución mensual de pérdidas (últimos 6 meses)
            </div>
            <div className="flex items-end gap-2 h-20">
              {monthlyTrend.map(({ month, count, amount }) => (
                <div key={month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-fg-muted tabular-nums">{count}</span>
                  <div
                    className="w-full bg-status-danger/50 rounded-t-sm"
                    style={{ height: `${Math.round((count / maxMonthCount) * 56)}px` }}
                    title={`${count} perdidas · ${fmt(amount)}`}
                  />
                  <span className="text-[10px] text-fg-muted">{month}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stage distribution */}
        {byStage.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
              Etapa en que se pierden
            </div>
            <div className="flex flex-col gap-1.5">
              {byStage.map(({ stage, count, amount, pct }) => (
                <div key={stage} className="flex items-center gap-3">
                  <div className="w-40 shrink-0 truncate text-sm text-fg-secondary" title={stage}>
                    {stage}
                  </div>
                  <div className="flex-1 relative h-2 rounded-full bg-fg-primary/10 overflow-hidden">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-status-danger/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs tabular-nums text-fg-muted w-28 text-right shrink-0">
                    {count} ({pct}%) · {fmt(amount)}
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

        {/* Panel informativo: habilitar motivos */}
        <div className="rounded-lg border border-stroke-soft bg-bg-surface-alt px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-fg-secondary">
            Análisis de motivos de pérdida — pendiente configuración
          </p>
          <p className="text-xs text-fg-muted">
            Clientify no registra motivos de pérdida de forma nativa. Para activar este análisis, pedirle
            al administrador del CRM que cree un campo personalizado de tipo <em>Dropdown</em> llamado{" "}
            <strong>&quot;Motivo de pérdida&quot;</strong> en los Deals, con opciones como: Precio,
            Competencia, No responde, Producto no aplica, Timing, etc. Una vez creado y completado en los
            deals perdidos, el análisis se activará automáticamente en el próximo sync.
          </p>
        </div>
      </div>
    </section>
  );
}
