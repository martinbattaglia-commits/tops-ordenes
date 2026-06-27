"use client";

import { useMemo } from "react";
import type { EnrichedDeal, Kpis } from "@/lib/comercial/dashboard-kpis";

const fmt = (n: number): string => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000)
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  return "$ " + v.toLocaleString("es-AR");
};

// Mapa de interpretaciones ejecutivas por motivo de pérdida
const REASON_INSIGHTS: Record<string, string> = {
  "Precio":          "Señal de competitividad de precio. Revisar estrategia de pricing y el valor percibido en la propuesta.",
  "Condiciones":     "Restricciones operativas o comerciales. Analizar si las condiciones son flexibilizables o si requieren nuevo enfoque.",
  "No contesta N/A": "Falla en el seguimiento. Estos deals necesitan un protocolo de reactivación antes de considerarse perdidos.",
  "Other":           "Motivos varios. Revisar el detalle individual para identificar patrones no categorizados.",
};

function getReasonInsight(reason: string): string {
  return REASON_INSIGHTS[reason] ?? "Revisar los deals individuales para determinar el patrón.";
}

const REASON_COLOR: Record<string, string> = {
  "Precio":          "bg-orange-500/80",
  "Condiciones":     "bg-yellow-500/80",
  "No contesta N/A": "bg-blue-500/80",
  "Other":           "bg-gray-400/80",
};

function reasonColor(reason: string): string {
  return REASON_COLOR[reason] ?? "bg-fg-muted/50";
}

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

  // Distribución por motivo de pérdida (campo nativo Clientify)
  const byReason = useMemo(() => {
    const map = new Map<string, { count: number; amount: number; deals: EnrichedDeal[] }>();
    let noReason = 0;
    for (const d of lostDeals) {
      const reason = d.loss_reason ?? null;
      if (!reason) { noReason++; continue; }
      const cur = map.get(reason) ?? { count: 0, amount: 0, deals: [] };
      map.set(reason, { count: cur.count + 1, amount: cur.amount + d.amount, deals: [...cur.deals, d] });
    }
    const rows = [...map.entries()]
      .map(([reason, v]) => ({
        reason,
        ...v,
        pct: Math.round((v.count / kpis.lostCount) * 100),
        ticketAvg: v.count > 0 ? v.amount / v.count : 0,
      }))
      .sort((a, b) => b.count - a.count);
    return { rows, noReason };
  }, [lostDeals, kpis.lostCount]);

  // Tendencia mensual por motivo
  const monthlyByReason = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const d of lostDeals) {
      const reason = d.loss_reason;
      if (!reason) continue;
      const dateStr = d.actual_close ?? d.modified_src;
      if (!dateStr) continue;
      const month = dateStr.slice(0, 7);
      if (!map.has(reason)) map.set(reason, new Map());
      const inner = map.get(reason)!;
      inner.set(month, (inner.get(month) ?? 0) + 1);
    }
    return map;
  }, [lostDeals]);

  // Serie de meses para la tendencia
  const months = useMemo(() => {
    const all = new Set<string>();
    for (const d of lostDeals) {
      const dateStr = d.actual_close ?? d.modified_src;
      if (dateStr) all.add(dateStr.slice(0, 7));
    }
    return [...all].sort().slice(-6);
  }, [lostDeals]);

  const monthLabels = useMemo(
    () =>
      months.map((m) =>
        new Date(m + "-15").toLocaleDateString("es-AR", { month: "short", year: "2-digit" })
      ),
    [months]
  );

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

  // Pipeline distribution
  const byPipeline = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const d of lostDeals) {
      const p = d.pipeline ?? "Sin pipeline";
      const cur = map.get(p) ?? { count: 0, amount: 0 };
      map.set(p, { count: cur.count + 1, amount: cur.amount + d.amount });
    }
    return [...map.entries()].map(([pipeline, v]) => ({ pipeline, ...v })).sort((a, b) => b.amount - a.amount);
  }, [lostDeals]);

  const total = kpis.wonAmount + kpis.lostAmount;
  const wonPct = total > 0 ? Math.round((kpis.wonAmount / total) * 100) : 0;
  const lostPct = total > 0 ? Math.round((kpis.lostAmount / total) * 100) : 0;
  const ticketAvg = kpis.lostCount > 0 ? kpis.lostAmount / kpis.lostCount : 0;

  const hasReasonData = byReason.rows.length > 0;
  const maxReasonCount = Math.max(...byReason.rows.map((r) => r.count), 1);

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

        {/* ── MOTIVOS DE PÉRDIDA (campo nativo Clientify) ── */}
        {hasReasonData ? (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-0.5">
                Motivos de pérdida
              </div>
              {byReason.noReason > 0 && (
                <p className="text-xs text-fg-muted">
                  {byReason.noReason} deal{byReason.noReason !== 1 ? "s" : ""} sin motivo completado en Clientify.
                </p>
              )}
            </div>

            {/* Barras horizontales por razón */}
            <div className="flex flex-col gap-3">
              {byReason.rows.map(({ reason, count, amount, pct, ticketAvg: ta }) => (
                <div key={reason} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-fg-primary">{reason}</span>
                    <span className="text-xs tabular-nums text-fg-muted">
                      {count} deals · {fmt(amount)} · ticket {fmt(ta)}
                    </span>
                  </div>
                  <div className="relative h-3 rounded-full bg-fg-primary/8 overflow-hidden">
                    <div
                      className={`absolute left-0 top-0 h-full rounded-full ${reasonColor(reason)}`}
                      style={{ width: `${Math.round((count / maxReasonCount) * 100)}%` }}
                      title={`${count} (${pct}%)`}
                    />
                  </div>
                  <p className="text-xs text-fg-muted leading-snug">{getReasonInsight(reason)}</p>
                </div>
              ))}
            </div>

            {/* Tendencia mensual por motivo */}
            {months.length > 1 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
                  Evolución mensual por motivo (últimos 6 meses)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-stroke-soft">
                        <th className="py-1.5 px-2 text-left font-semibold text-fg-muted uppercase tracking-wide w-36">
                          Motivo
                        </th>
                        {monthLabels.map((m, i) => (
                          <th key={i} className="py-1.5 px-2 text-right font-semibold text-fg-muted uppercase tracking-wide">
                            {m}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {byReason.rows.map(({ reason }) => (
                        <tr key={reason} className="border-b border-stroke-soft last:border-0 hover:bg-fg-primary/5">
                          <td className="py-1.5 px-2 font-medium text-fg-primary">{reason}</td>
                          {months.map((m) => {
                            const v = monthlyByReason.get(reason)?.get(m) ?? 0;
                            return (
                              <td key={m} className="py-1.5 px-2 text-right tabular-nums text-fg-secondary">
                                {v > 0 ? v : <span className="text-fg-muted/40">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Top deals perdidos con enlace directo */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
                Deals perdidos — enlace directo a Clientify
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-stroke-soft text-xs text-fg-muted uppercase tracking-wide">
                      <th className="py-1.5 px-2 text-left">Cliente</th>
                      <th className="py-1.5 px-2 text-left">Motivo</th>
                      <th className="py-1.5 px-2 text-right">Importe</th>
                      <th className="py-1.5 px-2 text-left">Responsable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lostDeals
                      .filter((d) => d.loss_reason)
                      .sort((a, b) => b.amount - a.amount)
                      .slice(0, 15)
                      .map((d) => (
                        <tr
                          key={d.deal_id}
                          className="border-b border-stroke-soft last:border-0 hover:bg-fg-primary/5 transition-colors"
                        >
                          <td className="py-2 px-2">
                            <a
                              href={d.href}
                              target="_blank"
                              rel="noreferrer"
                              className="text-fg-primary hover:text-brand underline-offset-2 hover:underline truncate block max-w-[200px]"
                              title={d.title}
                            >
                              {d.title}
                            </a>
                          </td>
                          <td className="py-2 px-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-white text-xs font-medium ${reasonColor(d.loss_reason ?? "")}`}>
                              {d.loss_reason}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums text-status-danger font-medium">
                            {fmt(d.amount)}
                          </td>
                          <td className="py-2 px-2 text-fg-muted text-xs">
                            {d.owner_name ?? "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* Sin datos de motivo todavía — el campo existe pero está vacío o el sync aún no corrió */
          <div className="rounded-lg border border-stroke-soft bg-bg-surface-alt px-4 py-3 space-y-1">
            <p className="text-sm font-semibold text-fg-secondary">
              Motivos de pérdida — sincronización pendiente
            </p>
            <p className="text-xs text-fg-muted">
              El campo <strong>Motivo de pérdida</strong> existe de forma nativa en Clientify y está
              configurado con las categorías: Precio, Condiciones, No contesta / N/A, Otros. El próximo
              sync diario (21:00 ART) cargará los datos y activará este análisis automáticamente.
            </p>
          </div>
        )}

        {/* Etapa en que se pierden */}
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
      </div>
    </section>
  );
}
