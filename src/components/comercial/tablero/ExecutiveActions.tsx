"use client";

import { Kpis, EnrichedDeal } from "@/lib/comercial/dashboard-kpis";
import { stalenessDays, isLiveOpportunity } from "@/lib/comercial/commercial-score";

interface Props {
  kpis: Kpis;
  deals: EnrichedDeal[];
}

type Priority = "critical" | "high" | "medium" | "low";

interface Recommendation {
  priority: Priority;
  title: string;
  reason: string;
  href?: string;
}

const fmt = (n: number): string =>
  Math.abs(n) >= 1_000_000
    ? "$ " + (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

const PRIORITY_DOT: Record<Priority, string> = {
  critical: "bg-status-danger",
  high: "bg-status-warning",
  medium: "bg-status-info",
  low: "bg-status-success",
};

const PRIORITY_BADGE: Record<Priority, string> = {
  critical: "badge badge-danger",
  high: "badge badge-warning",
  medium: "badge badge-info",
  low: "badge badge-success",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const PRIORITY_ORDER: Priority[] = ["critical", "high", "medium", "low"];

function buildRecommendations(kpis: Kpis, deals: EnrichedDeal[]): Recommendation[] {
  const recs: Recommendation[] = [];

  // Calcular pérdidas por razón
  const lostDeals = deals.filter((d) => d.status === "lost");
  const lossTotal = lostDeals.length;
  const reasonCounts: Record<string, number> = {};
  for (const d of lostDeals) {
    const r = d.loss_reason ?? "Sin clasificar";
    reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }

  const precioPct =
    lossTotal > 0 ? ((reasonCounts["Precio"] ?? 0) / lossTotal) * 100 : 0;
  const condicionesPct =
    lossTotal > 0 ? ((reasonCounts["Condiciones"] ?? 0) / lossTotal) * 100 : 0;

  // Regla 1: Sin seguimiento comercial
  if (kpis.noActionCount >= 5) {
    const today = new Date();
    const noActionDeals = deals.filter(
      (d) => isLiveOpportunity(d) && stalenessDays(d, today) >= 21
    );
    const noActionAmount = noActionDeals.reduce((a, d) => a + d.amount, 0);
    recs.push({
      priority: "critical",
      title: "Revisar seguimiento comercial",
      reason: `${kpis.noActionCount} oportunidades sin seguimiento${noActionAmount > 0 ? ` por ${fmt(noActionAmount)}` : ""}`,
      href: "/comercial/oportunidades?status=active&no_action=true",
    });
  } else if (kpis.noActionCount >= 3) {
    recs.push({
      priority: "high",
      title: "Revisar seguimiento comercial",
      reason: `${kpis.noActionCount} oportunidades sin actividad en más de 21 días`,
      href: "/comercial/oportunidades?status=active&no_action=true",
    });
  }

  // Regla 2: Forecast desactualizado (vencidas)
  if (kpis.overdueCount >= 2) {
    recs.push({
      priority: "critical",
      title: "Actualizar forecast",
      reason: `${kpis.overdueCount} oportunidades con fecha de cierre vencida por ${fmt(kpis.overdueAmount)}`,
      href: "/comercial/oportunidades?status=active&overdue=true",
    });
  }

  // Regla 3: Pérdidas por Precio > 30%
  if (precioPct > 30) {
    recs.push({
      priority: "high",
      title: "Revisar política de precios",
      reason: `${Math.round(precioPct)}% de las pérdidas son por precio (${reasonCounts["Precio"] ?? 0} deals)`,
      href: "/comercial/oportunidades?status=lost",
    });
  }

  // Regla 4: Pérdidas por Condiciones > 20%
  if (condicionesPct > 20) {
    recs.push({
      priority: "medium",
      title: "Analizar capacidad disponible",
      reason: `${Math.round(condicionesPct)}% de las pérdidas son por condiciones (${reasonCounts["Condiciones"] ?? 0} deals)`,
      href: "/comercial/oportunidades?status=lost",
    });
  }

  // Regla 5: Calidad de CRM baja
  if (kpis.dataQuality.score < 70) {
    recs.push({
      priority: "medium",
      title: "Mejorar completitud del CRM",
      reason: `Score de calidad: ${Math.round(kpis.dataQuality.score)}% — ${kpis.dataQuality.incomplete.length} deals con datos faltantes`,
      href: "#data-quality-block",
    });
  }

  // Sin problemas
  if (recs.length === 0) {
    recs.push({
      priority: "low",
      title: "Pipeline en buen estado",
      reason: "No se detectaron alertas críticas. Continúa el seguimiento habitual.",
      href: "/comercial/pipeline",
    });
  }

  // Ordenar por prioridad
  recs.sort(
    (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
  );

  return recs;
}

export function ExecutiveActions({ kpis, deals }: Props) {
  const recs = buildRecommendations(kpis, deals);
  const criticalCount = recs.filter((r) => r.priority === "critical").length;

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wide">
          ¿Qué hacer hoy?
        </h2>
        {criticalCount > 0 && (
          <span className="badge badge-danger text-xs">
            {criticalCount} {criticalCount === 1 ? "acción crítica" : "acciones críticas"}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-3">
        {recs.map((rec, i) => {
          const inner = (
            <>
              <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[rec.priority]}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-fg-primary text-sm">{rec.title}</span>
                  <span className={`${PRIORITY_BADGE[rec.priority]} text-xs px-2 py-0.5 rounded-full`}>
                    {PRIORITY_LABEL[rec.priority]}
                  </span>
                </div>
                <p className="text-xs text-fg-muted mt-0.5 leading-snug">{rec.reason}</p>
              </div>
              {rec.href && (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="flex-shrink-0 text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
            </>
          );
          const cls = `group flex items-start gap-3 rounded-lg border border-border p-3 transition-all duration-200 ${
            rec.href ? "hover:border-fg-brand/30 hover:bg-fg-primary/5 cursor-pointer" : ""
          }`;
          return rec.href ? (
            <li key={i}><a href={rec.href} className={cls}>{inner}</a></li>
          ) : (
            <li key={i} className={cls}>{inner}</li>
          );
        })}
      </ul>
    </div>
  );
}
