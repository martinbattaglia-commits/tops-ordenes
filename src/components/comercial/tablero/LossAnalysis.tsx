"use client";

import { useMemo } from "react";
import type { EnrichedDeal, Kpis } from "@/lib/comercial/dashboard-kpis";
import { type CanonicalReason, CANONICAL_REASONS } from "@/lib/clientify/loss-reason-normalizer";

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmt = (n: number): string => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000)
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  return "$ " + v.toLocaleString("es-AR");
};

// ─── Colores SVG (hex directos para SVG) ─────────────────────────────────────

const HEX: Record<CanonicalReason, string> = {
  "Precio":            "#f97316",
  "Condiciones":       "#eab308",
  "No contesta / N/A": "#3b82f6",
  "Otros":             "#8b5cf6",
  "Sin clasificar":    "#64748b",
};

const BADGE_CLS: Record<CanonicalReason, string> = {
  "Precio":            "bg-orange-500/15 text-orange-400",
  "Condiciones":       "bg-yellow-500/15 text-yellow-400",
  "No contesta / N/A": "bg-blue-500/15 text-blue-400",
  "Otros":             "bg-violet-500/15 text-violet-400",
  "Sin clasificar":    "bg-slate-500/15 text-slate-400",
};

const INSIGHT: Record<CanonicalReason, { title: string; body: string; icon: string }> = {
  "Precio":            { icon: "💲", title: "Precio",            body: "Estamos perdiendo principalmente por competitividad y valor percibido." },
  "Condiciones":       { icon: "⚙️",  title: "Condiciones",       body: "La principal limitación es operativa o contractual." },
  "No contesta / N/A": { icon: "📵", title: "No contesta / N/A", body: "Existe una oportunidad clara de mejorar el seguimiento." },
  "Otros":             { icon: "📋", title: "Otros",             body: "Revisar clasificación y profundizar en los sub-motivos." },
  "Sin clasificar":    { icon: "❓", title: "Sin clasificar",    body: "Completar el campo en Clientify para activar este análisis." },
};

// ─── Impacto badge ────────────────────────────────────────────────────────────

function ImpactBadge({ pct }: { pct: number }) {
  if (pct >= 30) return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-status-danger/15 text-status-danger">ALTO</span>
  );
  if (pct >= 15) return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-status-warning/15 text-status-warning">MEDIO</span>
  );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-status-success/15 text-status-success">BAJO</span>
  );
}

// ─── Sparkline mini ───────────────────────────────────────────────────────────

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-fg-muted text-xs">—</span>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;
  const W = 60, H = 22;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  const rising = values[values.length - 1] > values[0];
  const color = rising ? "#c90812" : "#0e7c3a"; // más pérdidas = rojo, menos = verde
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={parseFloat(pts.split(" ").at(-1)!.split(",")[0])}
        cy={parseFloat(pts.split(" ").at(-1)!.split(",")[1])}
        r={2.5} fill={color}
      />
    </svg>
  );
}

// ─── SVG Donut con labels en las rebanadas ────────────────────────────────────

interface DonutSlice { reason: CanonicalReason; count: number; pct: number }

function DonutChart({ slices, total }: { slices: DonutSlice[]; total: number }) {
  const cx = 100, cy = 100, r = 72, sw = 24;
  const circ = 2 * Math.PI * r;

  // Calculate arc positions
  let cumPct = 0;
  const arcs = slices.map((s) => {
    const startAngle = (cumPct / 100) * 360 - 90;
    const sweep = (s.pct / 100) * 360;
    const midAngle = startAngle + sweep / 2;
    const midRad = (midAngle * Math.PI) / 180;
    const labelR = r + 22;
    const lx = cx + labelR * Math.cos(midRad);
    const ly = cy + labelR * Math.sin(midRad);
    const dashLen = (s.pct / 100) * circ;
    const dashOffset = -(cumPct / 100) * circ;
    cumPct += s.pct;
    return { ...s, dashLen, dashOffset, lx, ly, midAngle };
  });

  return (
    <div className="flex-shrink-0">
      <svg width="200" height="200" viewBox="0 0 200 200">
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth={sw}
          className="text-fg-primary/8" />
        {/* Slices */}
        {arcs.map((arc) => (
          <circle key={arc.reason}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={HEX[arc.reason]}
            strokeWidth={sw}
            strokeDasharray={`${arc.dashLen} ${circ - arc.dashLen}`}
            strokeDashoffset={arc.dashOffset}
            strokeLinecap="butt"
            style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
          />
        ))}
        {/* Labels on slices */}
        {arcs.filter(a => a.pct >= 8).map((arc) => (
          <text key={arc.reason + "lbl"}
            x={arc.lx} y={arc.ly}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontSize: 10, fontWeight: 700, fill: HEX[arc.reason] }}>
            {arc.pct}%
          </text>
        ))}
        {/* Center */}
        <text x={cx} y={cy - 8} textAnchor="middle"
          style={{ fontSize: 30, fontWeight: 800, fill: "var(--fg-primary)" }}>
          {total}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle"
          style={{ fontSize: 11, fill: "var(--fg-muted)" }}>
          deals
        </text>
      </svg>
    </div>
  );
}

// ─── SVG Stacked bar chart ────────────────────────────────────────────────────

interface MonthBar { month: string; label: string; segments: { reason: CanonicalReason; amount: number }[]; total: number }

function StackedBarChart({ bars, reasons }: { bars: MonthBar[]; reasons: CanonicalReason[] }) {
  const maxTotal = Math.max(...bars.map((b) => b.total), 1);
  const chartH = 130;

  return (
    <div className="space-y-2 flex-1 min-w-0">
      <div className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">
        Evolución mensual por motivo (importe)
      </div>
      <div className="flex items-end gap-2" style={{ height: chartH + 20 }}>
        {bars.map((bar) => {
          const barH = Math.max((bar.total / maxTotal) * chartH, 2);
          let y = barH;
          return (
            <div key={bar.month} className="flex flex-col items-center gap-1 flex-1 min-w-0">
              <div className="w-full relative" style={{ height: chartH }}>
                <svg width="100%" height={barH} style={{ position: "absolute", bottom: 0, left: 0 }}
                  className="rounded-t overflow-hidden">
                  {reasons.map((rr) => {
                    const seg = bar.segments.find((s) => s.reason === rr);
                    if (!seg || seg.amount <= 0) return null;
                    const sh = (seg.amount / bar.total) * barH;
                    y -= sh;
                    return (
                      <rect key={rr} x="0" y={y} width="100%" height={sh}
                        fill={HEX[rr]} opacity={0.85} rx="1" />
                    );
                  })}
                </svg>
              </div>
              <span className="text-[10px] text-fg-muted truncate w-full text-center">{bar.label}</span>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {reasons.map((r) => (
          <span key={r} className="flex items-center gap-1 text-[10px] text-fg-muted">
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: HEX[r] }} />
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { deals: EnrichedDeal[]; kpis: Kpis }

export function LossAnalysis({ deals, kpis }: Props) {
  if (kpis.lostCount === 0) return null;
  return <LossAnalysisInner deals={deals} kpis={kpis} />;
}

function LossAnalysisInner({ deals, kpis }: Props) {
  const lostDeals = useMemo(() => deals.filter((d) => d.status === "lost"), [deals]);

  // ── Por motivo ─────────────────────────────────────────────────────────────
  const byReason = useMemo(() => {
    const map = new Map<CanonicalReason, { count: number; amount: number }>(
      CANONICAL_REASONS.map((r) => [r, { count: 0, amount: 0 }])
    );
    for (const d of lostDeals) {
      const reason: CanonicalReason = (d.loss_reason as CanonicalReason) ?? "Sin clasificar";
      const cur = map.get(reason)!;
      map.set(reason, { count: cur.count + 1, amount: cur.amount + d.amount });
    }
    return CANONICAL_REASONS
      .map((reason) => {
        const { count, amount } = map.get(reason)!;
        return {
          reason,
          count,
          amount,
          pct: kpis.lostCount > 0 ? Math.round((count / kpis.lostCount) * 100) : 0,
          ticketAvg: count > 0 ? amount / count : 0,
        };
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [lostDeals, kpis.lostCount]);

  // ── Evolución mensual ─────────────────────────────────────────────────────
  const { monthBars, months } = useMemo(() => {
    const map = new Map<string, Map<CanonicalReason, number>>();
    for (const d of lostDeals) {
      const dateStr = d.actual_close ?? d.modified_src;
      if (!dateStr) continue;
      const month = dateStr.slice(0, 7);
      if (!map.has(month)) map.set(month, new Map());
      const inner = map.get(month)!;
      const reason: CanonicalReason = (d.loss_reason as CanonicalReason) ?? "Sin clasificar";
      inner.set(reason, (inner.get(reason) ?? 0) + d.amount);
    }
    const sorted = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6);
    const months = sorted.map(([m]) => m);
    const monthBars: MonthBar[] = sorted.map(([month, seg]) => {
      const segments = CANONICAL_REASONS
        .filter((r) => (seg.get(r) ?? 0) > 0)
        .map((r) => ({ reason: r, amount: seg.get(r) ?? 0 }));
      const total = segments.reduce((s, x) => s + x.amount, 0);
      const label = new Date(month + "-15").toLocaleDateString("es-AR", { month: "short", year: "2-digit" });
      return { month, label, segments, total };
    });
    return { monthBars, months };
  }, [lostDeals]);

  // ── Sparklines por motivo (count por mes) ─────────────────────────────────
  const sparklineData = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const { reason } of byReason) {
      out[reason] = months.map((m) => {
        return lostDeals.filter((d) => {
          const dateStr = d.actual_close ?? d.modified_src;
          const r: CanonicalReason = (d.loss_reason as CanonicalReason) ?? "Sin clasificar";
          return dateStr?.startsWith(m) && r === reason;
        }).length;
      });
    }
    return out;
  }, [byReason, months, lostDeals]);

  const activeReasons = byReason.map((r) => r.reason);
  const donutSlices: DonutSlice[] = byReason.map((r) => ({ reason: r.reason, count: r.count, pct: r.pct }));
  const ticketAvgTotal = kpis.lostCount > 0 ? kpis.lostAmount / kpis.lostCount : 0;

  return (
    <section id="loss-analysis" className="space-y-4">
      <header>
        <h2 className="text-xl font-bold text-fg-primary">Motivos de Pérdida</h2>
        <p className="text-sm text-fg-muted">
          {kpis.lostCount} oportunidades perdidas · {fmt(kpis.lostAmount)} en importe total
        </p>
      </header>

      {/* ── Fila 1: Donut + Tabla simple + Barras (3 paneles en UNA fila) ── */}
      <div className="card card-pad">
        <div className="flex flex-col xl:flex-row gap-6 items-start">

          {/* Panel 1: Donut */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <DonutChart slices={donutSlices} total={kpis.lostCount} />
            <p className="text-xs text-fg-muted">
              Ticket promedio perdido: <strong className="text-fg-primary">{fmt(ticketAvgTotal)}</strong>
            </p>
          </div>

          {/* Panel 2: Tabla simplificada */}
          <div className="flex-shrink-0 min-w-[260px]">
            <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-3">Resumen</p>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[10px] text-fg-muted uppercase tracking-wide border-b border-stroke-soft">
                  <th className="pb-1.5 pr-3 text-left">Motivo</th>
                  <th className="pb-1.5 pr-2 text-right">Deals</th>
                  <th className="pb-1.5 pr-2 text-right">%</th>
                  <th className="pb-1.5 text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {byReason.map(({ reason, count, amount, pct }) => (
                  <tr key={reason} className="border-b border-stroke-soft last:border-0">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: HEX[reason as CanonicalReason] }} />
                        <span className="text-fg-primary text-xs font-medium">{reason}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-fg-secondary text-xs">{count}</td>
                    <td className="py-2 pr-2 text-right text-xs">
                      <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-bold ${BADGE_CLS[reason as CanonicalReason]}`}>
                        {pct}%
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-xs font-semibold text-status-danger">{fmt(amount)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-stroke-soft">
                  <td className="py-1.5 pr-3 text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Total</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-xs font-bold text-fg-primary">{kpis.lostCount}</td>
                  <td className="py-1.5 pr-2 text-right text-xs text-fg-muted">100%</td>
                  <td className="py-1.5 text-right tabular-nums text-xs font-bold text-status-danger">{fmt(kpis.lostAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Panel 3: Bar chart */}
          {monthBars.length > 1 && (
            <StackedBarChart bars={monthBars} reasons={activeReasons} />
          )}
        </div>
      </div>

      {/* ── Fila 2: Tabla detallada con sparklines + Interpretación automática ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Resumen con sparklines + impacto */}
        <div className="xl:col-span-2 card card-pad space-y-3">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
            Resumen por motivo de pérdida
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[10px] text-fg-muted uppercase tracking-wide border-b border-stroke-soft">
                  <th className="pb-1.5 pr-3 text-left">Motivo</th>
                  <th className="pb-1.5 pr-3 text-right">Cantidad</th>
                  <th className="pb-1.5 pr-3 text-right">%</th>
                  <th className="pb-1.5 pr-3 text-right">Importe perdido</th>
                  <th className="pb-1.5 pr-3 text-right">Ticket prom.</th>
                  {months.length > 1 && <th className="pb-1.5 pr-3 text-center">Tendencia (6M)</th>}
                  <th className="pb-1.5 text-center">Impacto</th>
                </tr>
              </thead>
              <tbody>
                {byReason.map(({ reason, count, amount, pct, ticketAvg }) => (
                  <tr key={reason}
                    className="border-b border-stroke-soft last:border-0 hover:bg-fg-primary/5 transition-colors group cursor-pointer"
                  >
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: HEX[reason as CanonicalReason] }} />
                        <span className="font-semibold text-fg-primary group-hover:underline group-hover:text-fg-brand transition-colors">
                          {reason}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-fg-secondary">{count}</td>
                    <td className="py-2.5 pr-3 text-right">
                      <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-bold ${BADGE_CLS[reason as CanonicalReason]}`}>
                        {pct}%
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-semibold text-status-danger">{fmt(amount)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-fg-muted text-xs">{fmt(ticketAvg)}</td>
                    {months.length > 1 && (
                      <td className="py-2.5 pr-3 text-center">
                        <Sparkline values={sparklineData[reason] ?? []} />
                      </td>
                    )}
                    <td className="py-2.5 text-center">
                      <ImpactBadge pct={pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Interpretación automática */}
        <div className="card card-pad space-y-3">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
            Interpretación automática
          </p>
          <div className="flex flex-col gap-3">
            {byReason.map(({ reason }) => {
              const ins = INSIGHT[reason as CanonicalReason];
              return (
                <div key={reason}
                  className="flex gap-3 p-3 rounded-lg border border-stroke-soft hover:border-fg-primary/20 transition-colors"
                  style={{ borderLeftWidth: 3, borderLeftColor: HEX[reason as CanonicalReason] }}
                >
                  <span className="text-lg flex-shrink-0">{ins.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-fg-primary leading-snug">{ins.title}</p>
                    <p className="text-xs text-fg-muted leading-relaxed mt-0.5">{ins.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Fila 3: Dónde y en qué pipeline se pierde ── */}
      <LossBreakdown deals={lostDeals} kpis={kpis} />

    </section>
  );
}

// ─── Breakdown: etapa + pipeline ─────────────────────────────────────────────

function LossBreakdown({ deals, kpis }: { deals: EnrichedDeal[]; kpis: Kpis }) {
  const byStage = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const d of deals) {
      const s = d.stage ?? "Sin etapa";
      const cur = map.get(s) ?? { count: 0, amount: 0 };
      map.set(s, { count: cur.count + 1, amount: cur.amount + d.amount });
    }
    return [...map.entries()]
      .map(([stage, v]) => ({ stage, ...v, pct: Math.round((v.count / kpis.lostCount) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [deals, kpis.lostCount]);

  const byPipeline = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const d of deals) {
      const p = d.pipeline ?? "Sin pipeline";
      const cur = map.get(p) ?? { count: 0, amount: 0 };
      map.set(p, { count: cur.count + 1, amount: cur.amount + d.amount });
    }
    return [...map.entries()]
      .map(([pipeline, v]) => ({ pipeline, ...v, pct: Math.round((v.count / kpis.lostCount) * 100) }))
      .sort((a, b) => b.amount - a.amount);
  }, [deals, kpis.lostCount]);

  const maxStage = Math.max(...byStage.map((s) => s.count), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {byStage.length > 0 && (
        <div className="card card-pad space-y-3">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Etapa donde se pierden</p>
          <div className="flex flex-col gap-2.5">
            {byStage.map(({ stage, count, amount, pct }) => (
              <div key={stage} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-fg-secondary truncate" title={stage}>{stage}</span>
                  <span className="text-fg-muted tabular-nums flex-shrink-0">{count} ({pct}%) · {fmt(amount)}</span>
                </div>
                <div className="h-2 rounded-full bg-fg-primary/8 overflow-hidden">
                  <div className="h-full rounded-full bg-status-danger/70 transition-all"
                    style={{ width: `${Math.round((count / maxStage) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {byPipeline.length > 0 && (
        <div className="card card-pad space-y-3">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Por pipeline</p>
          <div className="flex flex-col gap-2.5">
            {byPipeline.map(({ pipeline, count, amount, pct }) => (
              <div key={pipeline} className="flex items-center gap-3">
                <span className="text-sm text-fg-secondary w-36 shrink-0 truncate">{pipeline}</span>
                <div className="flex-1 h-2.5 rounded-full bg-fg-primary/8 overflow-hidden">
                  <div className="h-full rounded-full bg-status-danger/50 transition-all"
                    style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs tabular-nums text-right shrink-0 w-28">
                  <span className="font-semibold text-status-danger">{fmt(amount)}</span>
                  <span className="ml-1 text-fg-muted">({count})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
