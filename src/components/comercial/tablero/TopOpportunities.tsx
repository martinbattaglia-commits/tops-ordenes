"use client";

import { useMemo } from "react";
import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";
import {
  isLiveOpportunity,
  calculateCommercialScore,
  calculateWeightedForecast,
  normalizeScore,
  getSemaforoColor,
  stalenessDays,
  getOpportunityAlert,
} from "@/lib/comercial/commercial-score";

// ─── fmt helper ──────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000)
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  return "$ " + v.toLocaleString("es-AR");
};

// ─── Semáforo reason ─────────────────────────────────────────────────────────

function semaforoReason(d: EnrichedDeal, score: number, today: Date): string {
  const color = getSemaforoColor(score);
  if (color === "green") return "Prioritaria — probabilidad alta o actividad reciente";
  if (color === "red") {
    const alert = getOpportunityAlert(d, today);
    return alert ? `En riesgo — ${alert.label}` : "En riesgo — baja prioridad";
  }
  return "En seguimiento — activa, revisar próxima acción";
}

// ─── Dot color class ─────────────────────────────────────────────────────────

function dotClass(color: "green" | "yellow" | "red"): string {
  if (color === "green") return "bg-status-success";
  if (color === "yellow") return "bg-status-warning";
  return "bg-status-danger";
}

// ─── Badge class by semáforo tier ────────────────────────────────────────────

function badgeClass(color: "green" | "yellow" | "red"): string {
  if (color === "green") return "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold bg-status-success/15 text-status-success tabular-nums";
  if (color === "yellow") return "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold bg-status-warning/15 text-status-warning tabular-nums";
  return "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold bg-status-danger/15 text-status-danger tabular-nums";
}

// ─── Prob color class ─────────────────────────────────────────────────────────

function probClass(p: number): string {
  if (p >= 50) return "text-status-success font-semibold tabular-nums";
  if (p >= 25) return "text-status-warning font-semibold tabular-nums";
  return "text-status-danger font-semibold tabular-nums";
}

// ─── Stale color class ────────────────────────────────────────────────────────

function staleClass(days: number): string {
  if (days === Infinity) return "text-fg-muted tabular-nums";
  if (days < 7) return "text-status-success tabular-nums";
  if (days < 21) return "text-status-warning tabular-nums";
  return "text-status-danger font-semibold tabular-nums";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TopOpportunities({ deals }: { deals: EnrichedDeal[] }) {
  const today = useMemo(() => new Date(), []);

  // Compute top 10 live deals by normalized commercial score
  const top10 = useMemo(() => {
    const live = deals.filter(isLiveOpportunity);
    if (!live.length) return [];
    const rawScores = live.map((d) => calculateCommercialScore(d, today));
    return live
      .map((d, i) => ({ d, raw: rawScores[i] }))
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 10)
      .map(({ d, raw }) => {
        const normalized = normalizeScore(rawScores, raw);
        const color = getSemaforoColor(normalized);
        const weightedForecast = calculateWeightedForecast(d);
        const staleDays = stalenessDays(d, today);
        return { d, normalized, color, weightedForecast, staleDays };
      });
  }, [deals, today]);

  if (!top10.length) {
    return (
      <section className="space-y-4">
        <header>
          <h2 className="text-xl font-bold text-fg-primary">Top oportunidades para atacar ahora</h2>
          <p className="text-sm text-fg-muted">Ordenadas por score comercial — las que merecen atención hoy</p>
        </header>
        <div className="card card-pad">
          <p className="text-sm text-fg-muted">No hay oportunidades vivas en el CRM.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-bold text-fg-primary">Top oportunidades para atacar ahora</h2>
        <p className="text-sm text-fg-muted">Ordenadas por score comercial — las que merecen atención hoy</p>
      </header>

      <div className="card card-pad overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-stroke-soft text-xs text-fg-muted uppercase tracking-wide">
              <th className="py-2 px-2 text-left w-6">#</th>
              <th className="py-2 px-2 text-center w-8">Sem.</th>
              <th className="py-2 px-2 text-center w-16">Score</th>
              <th className="py-2 px-2 text-left">Empresa / Oportunidad</th>
              <th className="py-2 px-2 text-right hidden md:table-cell">Valor bruto</th>
              <th className="py-2 px-2 text-right hidden md:table-cell">Valor esp.</th>
              <th className="py-2 px-2 text-right hidden md:table-cell">Prob%</th>
              <th className="py-2 px-2 text-left hidden md:table-cell">Etapa</th>
              <th className="py-2 px-2 text-right hidden md:table-cell">Sin act.</th>
              <th className="py-2 px-2 text-left hidden md:table-cell">Horizonte</th>
              <th className="py-2 px-2 text-left hidden md:table-cell">Responsable</th>
              <th className="py-2 px-2 text-left hidden md:table-cell">Fuente</th>
              <th className="py-2 px-2 text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {top10.map(({ d, normalized, color, weightedForecast, staleDays }, i) => {
              const reason = semaforoReason(d, normalized, today);
              const scoreTip = `Score: ${normalized}/100 | Valor esp.: ${fmt(weightedForecast)} | ${staleDays === Infinity ? "sin actividad registrada" : `${staleDays}d sin actividad`}`;

              return (
                <tr
                  key={d.deal_id}
                  className="border-b border-stroke-soft last:border-0 hover:bg-fg-primary/5 transition-colors"
                >
                  {/* Rank */}
                  <td className="py-2.5 px-2 text-xs text-fg-muted font-semibold">
                    {i + 1}
                  </td>

                  {/* Semáforo dot */}
                  <td className="py-2.5 px-2 text-center">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${dotClass(color)}`}
                      title={reason}
                    />
                  </td>

                  {/* Score badge */}
                  <td className="py-2.5 px-2 text-center">
                    <span
                      className={badgeClass(color)}
                      title={scoreTip}
                    >
                      {normalized}
                    </span>
                  </td>

                  {/* Company + Title */}
                  <td className="py-2.5 px-2">
                    <div className="font-semibold text-fg-primary leading-snug truncate max-w-[200px]">
                      {d.company_name ?? d.title}
                    </div>
                    <div className="text-xs text-fg-muted truncate max-w-[200px]">
                      {d.company_name ? d.title : ""}
                    </div>
                  </td>

                  {/* Valor bruto */}
                  <td className="py-2.5 px-2 text-right hidden md:table-cell tabular-nums text-fg-primary font-medium">
                    {fmt(d.amount)}
                  </td>

                  {/* Valor esperado */}
                  <td className="py-2.5 px-2 text-right hidden md:table-cell tabular-nums text-fg-secondary">
                    {fmt(weightedForecast)}
                  </td>

                  {/* Prob% */}
                  <td className={`py-2.5 px-2 text-right hidden md:table-cell ${probClass(d.effective_probability)}`}>
                    {d.effective_probability}%
                  </td>

                  {/* Etapa */}
                  <td className="py-2.5 px-2 hidden md:table-cell text-fg-secondary truncate max-w-[120px]">
                    {d.stage ?? "—"}
                  </td>

                  {/* Días sin actividad */}
                  <td className={`py-2.5 px-2 text-right hidden md:table-cell ${staleClass(staleDays)}`}>
                    {staleDays === Infinity ? "—" : `${staleDays}d`}
                  </td>

                  {/* Horizonte */}
                  <td className="py-2.5 px-2 hidden md:table-cell text-fg-secondary text-xs">
                    {d.overlay_horizonte ?? "—"}
                  </td>

                  {/* Responsable */}
                  <td className="py-2.5 px-2 hidden md:table-cell text-fg-secondary text-xs truncate max-w-[100px]">
                    {d.owner_name ?? "—"}
                  </td>

                  {/* Fuente */}
                  <td className="py-2.5 px-2 hidden md:table-cell text-fg-muted text-xs truncate max-w-[80px]">
                    {d.deal_source ?? "—"}
                  </td>

                  {/* Acción: link to Clientify */}
                  <td className="py-2.5 px-2 text-center">
                    <a
                      href={d.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-fg-brand hover:underline font-medium"
                      title="Ver en Clientify"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      <span className="hidden sm:inline">Ver</span>
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
