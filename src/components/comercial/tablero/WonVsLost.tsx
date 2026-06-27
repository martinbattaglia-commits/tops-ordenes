"use client";

import { Kpis, EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

interface Props {
  kpis: Kpis;
  deals: EnrichedDeal[];
}

const fmt = (n: number): string =>
  Math.abs(n) >= 1_000_000
    ? "$ " + (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

const fmtPct = (n: number): string => n.toFixed(1) + "%";

export function WonVsLost({ kpis }: Props) {
  const total = kpis.wonCount + kpis.lostCount;
  const wonRate = total > 0 ? (kpis.wonCount / total) * 100 : 0;
  const lostRate = total > 0 ? (kpis.lostCount / total) * 100 : 0;

  const wonAvg = kpis.wonCount > 0 ? kpis.wonAmount / kpis.wonCount : 0;
  const lostAvg = kpis.lostCount > 0 ? kpis.lostAmount / kpis.lostCount : 0;

  const wonBarPct = total > 0 ? (kpis.wonCount / total) * 100 : 0;

  return (
    <div className="card card-pad">
      <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wide mb-4">
        Ganado vs. Perdido
      </h2>

      <div className="grid grid-cols-2 gap-4">
        {/* Ganado */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-status-success inline-block" />
            <span className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">
              Ganado
            </span>
          </div>
          <span className="text-2xl font-bold text-status-success leading-none">
            {fmt(kpis.wonAmount)}
          </span>
          <div className="flex flex-col gap-1 text-sm text-fg-secondary">
            <div className="flex justify-between">
              <span className="text-fg-muted">Deals</span>
              <span className="font-medium text-fg-primary">{kpis.wonCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Ticket prom.</span>
              <span className="font-medium text-fg-primary">
                {kpis.wonCount > 0 ? fmt(wonAvg) : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Tasa de cierre</span>
              <span className="font-medium text-status-success">
                {fmtPct(wonRate)}
              </span>
            </div>
          </div>
        </div>

        {/* Perdido */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-status-danger inline-block" />
            <span className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">
              Perdido
            </span>
          </div>
          <span className="text-2xl font-bold text-status-danger leading-none">
            {fmt(kpis.lostAmount)}
          </span>
          <div className="flex flex-col gap-1 text-sm text-fg-secondary">
            <div className="flex justify-between">
              <span className="text-fg-muted">Deals</span>
              <span className="font-medium text-fg-primary">{kpis.lostCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Ticket prom.</span>
              <span className="font-medium text-fg-primary">
                {kpis.lostCount > 0 ? fmt(lostAvg) : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Tasa de pérdida</span>
              <span className="font-medium text-status-danger">
                {fmtPct(lostRate)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Barra proporcional */}
      {total > 0 && (
        <div className="mt-4">
          <div className="flex rounded-full overflow-hidden h-2">
            <div
              className="bg-status-success transition-all"
              style={{ width: `${wonBarPct}%` }}
            />
            <div
              className="bg-status-danger flex-1 transition-all"
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-fg-muted">
            <span>{kpis.wonCount} ganados</span>
            <span>{kpis.lostCount} perdidos</span>
          </div>
        </div>
      )}

      {total === 0 && (
        <p className="mt-4 text-sm text-fg-muted text-center">
          Sin datos de cierre en el período.
        </p>
      )}
    </div>
  );
}
