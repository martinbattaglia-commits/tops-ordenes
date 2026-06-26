"use client";

import { useState, useMemo } from "react";
import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";
import { getSuggestedAction, stalenessDays, isLiveOpportunity } from "@/lib/comercial/commercial-score";

// ─── fmt helper ──────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000)
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  return "$ " + v.toLocaleString("es-AR");
};

const fmtDate = (s: string | null): string => {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  } catch {
    return "—";
  }
};

// ─── Threshold selector ───────────────────────────────────────────────────────

const THRESHOLDS = [14, 21, 30, 60] as const;
type ThresholdDays = (typeof THRESHOLDS)[number];

// ─── External link SVG ───────────────────────────────────────────────────────

function ExternalLinkIcon() {
  return (
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
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  deals: EnrichedDeal[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StagnantOpportunities({ deals }: Props) {
  const [threshold, setThreshold] = useState<ThresholdDays>(21);

  const today = useMemo(() => new Date(), []);

  const stagnant = useMemo(() => {
    return deals
      .filter(isLiveOpportunity)
      .map((d) => {
        const days = stalenessDays(d, today);
        return { ...d, staleDays: days };
      })
      .filter((d) => d.staleDays >= threshold)
      .sort((a, b) => {
        // Infinity (no date) sorts last since we can't really compare
        if (a.staleDays === Infinity && b.staleDays === Infinity) return 0;
        if (a.staleDays === Infinity) return 1;
        if (b.staleDays === Infinity) return -1;
        return b.staleDays - a.staleDays;
      });
  }, [deals, threshold, today]);

  return (
    <section id="stagnant-block" className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-fg-primary">Oportunidades estancadas</h2>
          <p className="text-sm text-fg-muted">
            Sin actividad en Clientify en los últimos {threshold} días
          </p>
        </div>

        {/* Threshold selector */}
        <div className="flex items-center gap-1 rounded-lg border border-stroke-soft p-0.5 bg-bg-surface-alt">
          {THRESHOLDS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setThreshold(t)}
              className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                threshold === t
                  ? "bg-fg-brand text-white shadow-sm"
                  : "text-fg-secondary hover:bg-fg-primary/10"
              }`}
            >
              {t}d
            </button>
          ))}
        </div>
      </header>

      {stagnant.length === 0 ? (
        <div className="card card-pad">
          <p className="text-sm text-status-success font-medium">
            No hay oportunidades estancadas en los últimos {threshold}d. El equipo está al día. ✓
          </p>
        </div>
      ) : (
        <div className="card card-pad overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-stroke-soft text-xs text-fg-muted uppercase tracking-wide">
                <th className="py-2 px-2 text-center w-8">Sem.</th>
                <th className="py-2 px-2 text-left">Empresa</th>
                <th className="py-2 px-2 text-left hidden sm:table-cell">Oportunidad</th>
                <th className="py-2 px-2 text-right hidden md:table-cell">Valor</th>
                <th className="py-2 px-2 text-right hidden md:table-cell">Prob%</th>
                <th className="py-2 px-2 text-left hidden lg:table-cell">Etapa</th>
                <th className="py-2 px-2 text-right">Días sin act.</th>
                <th className="py-2 px-2 text-right hidden md:table-cell">Últ. actividad</th>
                <th className="py-2 px-2 text-left hidden lg:table-cell">Responsable</th>
                <th className="py-2 px-2 text-left hidden md:table-cell">Acción sugerida</th>
                <th className="py-2 px-2 text-center">Ver</th>
              </tr>
            </thead>
            <tbody>
              {stagnant.map((d) => {
                const action = getSuggestedAction(d, today);
                const staleDaysDisplay =
                  d.staleDays === Infinity ? "Sin registro" : `${d.staleDays}d`;

                return (
                  <tr
                    key={d.deal_id}
                    className="border-b border-stroke-soft last:border-0 hover:bg-fg-primary/5 transition-colors"
                  >
                    {/* Semáforo: all stagnant = red */}
                    <td className="py-2.5 px-2 text-center">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full bg-status-danger"
                        title="En riesgo — sin actividad reciente"
                      />
                    </td>

                    {/* Empresa */}
                    <td className="py-2.5 px-2 font-medium text-fg-primary truncate max-w-[140px]">
                      {d.company_name ?? d.title}
                    </td>

                    {/* Oportunidad */}
                    <td className="py-2.5 px-2 hidden sm:table-cell text-fg-secondary truncate max-w-[160px]">
                      {d.company_name ? d.title : ""}
                    </td>

                    {/* Valor */}
                    <td className="py-2.5 px-2 text-right hidden md:table-cell tabular-nums text-fg-primary font-medium">
                      {d.amount > 0 ? fmt(d.amount) : "—"}
                    </td>

                    {/* Prob% */}
                    <td className="py-2.5 px-2 text-right hidden md:table-cell tabular-nums">
                      <span
                        className={
                          d.effective_probability >= 50
                            ? "text-status-success font-semibold"
                            : d.effective_probability >= 25
                            ? "text-status-warning font-semibold"
                            : "text-status-danger font-semibold"
                        }
                      >
                        {d.effective_probability}%
                      </span>
                    </td>

                    {/* Etapa */}
                    <td className="py-2.5 px-2 hidden lg:table-cell text-fg-secondary text-xs truncate max-w-[100px]">
                      {d.stage ?? "—"}
                    </td>

                    {/* Días sin actividad */}
                    <td className="py-2.5 px-2 text-right tabular-nums text-status-danger font-semibold">
                      {staleDaysDisplay}
                    </td>

                    {/* Última actividad */}
                    <td className="py-2.5 px-2 text-right hidden md:table-cell text-fg-muted text-xs tabular-nums">
                      {fmtDate(d.modified_src)}
                    </td>

                    {/* Responsable */}
                    <td className="py-2.5 px-2 hidden lg:table-cell text-fg-secondary text-xs truncate max-w-[100px]">
                      {d.owner_name ?? "—"}
                    </td>

                    {/* Acción sugerida */}
                    <td className="py-2.5 px-2 hidden md:table-cell">
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-status-warning/15 text-status-warning whitespace-nowrap">
                        {action}
                      </span>
                    </td>

                    {/* Ver en Clientify */}
                    <td className="py-2.5 px-2 text-center">
                      <a
                        href={d.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-fg-brand hover:underline font-medium"
                        title="Ver en Clientify"
                      >
                        <ExternalLinkIcon />
                        <span className="hidden sm:inline">Ver</span>
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer */}
          <div className="mt-3 pt-3 border-t border-stroke-soft flex items-center justify-between text-xs text-fg-muted">
            <span>{stagnant.length} oportunidad{stagnant.length === 1 ? "" : "es"} estancada{stagnant.length === 1 ? "" : "s"}</span>
            <span>Ordena por días sin actividad (mayor primero)</span>
          </div>
        </div>
      )}
    </section>
  );
}
