"use client";

import { Kpis, EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

interface Props {
  kpis: Kpis;
  deals: EnrichedDeal[];
  lastSync: string | null;
}

const fmt = (n: number): string =>
  Math.abs(n) >= 1_000_000
    ? "$ " + (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

export function ExecutiveNarrative({ kpis, deals, lastSync }: Props) {
  // Calculate top 2 loss reasons from deals
  const lostDeals = deals.filter((d) => d.status === "lost");
  const reasonCounts: Record<string, number> = {};
  for (const d of lostDeals) {
    const r = d.loss_reason ?? "Sin clasificar";
    reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  const topReasons = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([reason]) => reason);

  const lossTotal = lostDeals.length;
  const top2Count = topReasons.reduce((acc, r) => acc + (reasonCounts[r] ?? 0), 0);
  const top2Pct = lossTotal > 0 ? Math.round((top2Count / lossTotal) * 100) : 0;

  const criticalCount = kpis.overdueCount + kpis.noActionCount;

  const concrecionPct = Math.round(kpis.weightedConcretion);

  return (
    <div className="card card-pad border-l-4 border-fg-brand">
      <p className="text-sm text-fg-secondary leading-relaxed">
        El pipeline activo asciende a{" "}
        <strong className="text-fg-primary">{fmt(kpis.activePipeline)}</strong>.{" "}
        El forecast ponderado es de{" "}
        <strong className="text-fg-primary">{fmt(kpis.forecast)}</strong>{" "}
        <span className="text-fg-muted">({concrecionPct}% de concreción)</span>.{" "}
        Durante el período se{" "}
        {kpis.lostCount > 0 ? (
          <>
            perdieron{" "}
            <strong className="text-fg-primary">{fmt(kpis.lostAmount)}</strong>{" "}
            en{" "}
            <strong className="text-fg-primary">{kpis.lostCount}</strong>{" "}
            {kpis.lostCount === 1 ? "oportunidad" : "oportunidades"}.{" "}
            {topReasons.length >= 2 && (
              <>
                El{" "}
                <strong className="text-fg-primary">{top2Pct}%</strong>{" "}
                de las pérdidas se concentra en{" "}
                <strong className="text-fg-primary">{topReasons[0]}</strong>{" "}
                y{" "}
                <strong className="text-fg-primary">{topReasons[1]}</strong>.{" "}
              </>
            )}
            {topReasons.length === 1 && (
              <>
                La principal razón de pérdida es{" "}
                <strong className="text-fg-primary">{topReasons[0]}</strong>.{" "}
              </>
            )}
          </>
        ) : (
          <>
            <span>no registraron pérdidas en el período. </span>
          </>
        )}
        La calidad del CRM es{" "}
        <strong className="text-fg-primary">{Math.round(kpis.dataQuality.score)}%</strong>.{" "}
        {criticalCount > 0 && (
          <>
            <strong className="text-status-danger">{criticalCount}</strong>{" "}
            {criticalCount === 1 ? "oportunidad crítica requiere" : "oportunidades críticas requieren"}{" "}
            acción inmediata.
          </>
        )}
        {criticalCount === 0 && (
          <span className="text-status-success">No hay oportunidades críticas pendientes.</span>
        )}
      </p>
      {lastSync && (
        <p className="mt-2 text-xs text-fg-muted">
          Última sincronización: {lastSync}
        </p>
      )}
    </div>
  );
}
