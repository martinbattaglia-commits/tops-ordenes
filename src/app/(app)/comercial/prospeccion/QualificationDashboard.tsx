"use client";

import type { QualificationSummary } from "@/lib/prospeccion/read/qualification-data";

interface QualificationDashboardProps {
  summary: QualificationSummary;
  onQualifyAll?: () => void;
  isQualifying?: boolean;
  processingTimeMs?: number;
}

type KpiVariant = "default" | "green" | "amber" | "red" | "blue";

interface StatCardProps {
  label: string;
  value: number | string;
  variant?: KpiVariant;
}

const ACCENT_CLASS: Record<KpiVariant, string> = {
  default: "bg-stroke-soft",
  green:   "bg-status-success",
  amber:   "bg-status-warning",
  red:     "bg-tops-red",
  blue:    "bg-tops-blue-700",
};

// Números en blanco neutro (protagonismo por tamaño, no por saturación);
// el color semántico lo lleva la barra de acento + la etiqueta.
const VALUE_CLASS: Record<KpiVariant, string> = {
  default: "text-fg-primary",
  green:   "text-fg-primary",
  amber:   "text-fg-primary",
  red:     "text-fg-primary",
  blue:    "text-fg-primary",
};

function StatCard({ label, value, variant = "default" }: StatCardProps) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className={`absolute inset-x-0 top-0 h-px ${ACCENT_CLASS[variant]} opacity-60`} />
      <p className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums leading-none ${VALUE_CLASS[variant]}`}>{value}</p>
    </div>
  );
}

export function QualificationDashboard({
  summary,
  onQualifyAll,
  isQualifying,
  processingTimeMs,
}: QualificationDashboardProps) {
  const {
    totalImported,
    totalScoreado,
    totalAprobado,
    decisionCounts,
    avgScore,
    byIndustry,
    byCargo,
    byDecision,
  } = summary;

  const totalDecisions =
    decisionCounts.import + decisionCounts.review + decisionCounts.discard;

  return (
    <div className="space-y-6">
      {/* Banner: sin calificar */}
      {onQualifyAll && totalScoreado === 0 && (
        <div className="flex items-center justify-between gap-4 card bg-tops-blue-700/10 p-4">
          <div>
            <p className="text-sm font-semibold text-fg-primary">
              {totalImported > 0
                ? `${totalImported} prospectos importados sin calificar.`
                : "Importá prospectos para comenzar la calificación."}
            </p>
            <p className="mt-0.5 text-xs text-fg-secondary">
              El motor de IA asigna score 0–100 y decide Excelente / Revisar / Descartar.
            </p>
          </div>
          <button
            onClick={onQualifyAll}
            disabled={isQualifying || totalImported === 0}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-tops-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tops-blue-900 disabled:opacity-50 transition-colors"
          >
            {isQualifying ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Calificando…
              </>
            ) : (
              "Calificar todos"
            )}
          </button>
        </div>
      )}

      {isQualifying && totalScoreado > 0 && (
        <div className="flex items-center gap-2 card bg-status-warning/10 p-3 text-sm text-amber-400">
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Calificando prospectos…
        </div>
      )}

      {processingTimeMs !== undefined && (
        <p className="text-xs text-fg-muted">
          Procesado en {(processingTimeMs / 1000).toFixed(1)}s
        </p>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Importados"      value={totalImported}  variant="blue" />
        <StatCard label="Calificados"     value={totalScoreado}  variant="blue" />
        <StatCard label="🟢 Excelentes"  value={decisionCounts.import}  variant="green" />
        <StatCard label="🟡 Para revisar" value={decisionCounts.review} variant="amber" />
        <StatCard label="🔴 Descartados" value={decisionCounts.discard} variant="red" />
        <StatCard
          label="Score promedio"
          value={avgScore > 0 ? avgScore.toFixed(1) : "—"}
          variant="blue"
        />
        <StatCard label="Aprobados" value={totalAprobado} variant="green" />
      </div>

      {/* Distribución por decisión */}
      {totalDecisions > 0 && (
        <div className="card p-5 space-y-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">
            Distribución por decisión del motor
          </h3>
          <div className="space-y-3">
            {byDecision.map(({ decision, count }) => {
              const pct = Math.round((count / totalDecisions) * 100);
              const cfg =
                decision === "import"
                  ? { label: "🟢 Excelente", barClass: "bg-status-success", textClass: "text-emerald-400" }
                  : decision === "review"
                    ? { label: "🟡 Revisar",    barClass: "bg-status-warning", textClass: "text-amber-400" }
                    : decision === "discard"
                      ? { label: "🔴 Descartar", barClass: "bg-tops-red",     textClass: "text-red-400" }
                      : { label: decision,        barClass: "bg-stroke-soft",   textClass: "text-fg-muted" };
              return (
                <div key={decision} className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-fg-secondary">{cfg.label}</span>
                    <span className={`font-semibold tabular-nums ${cfg.textClass}`}>
                      {count} <span className="text-fg-muted">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-bg-surface-alt">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${cfg.barClass}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {byIndustry.length > 0 && (
          <div className="card p-5 space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">Top industrias</h3>
            <ul className="divide-y divide-stroke-soft">
              {byIndustry.slice(0, 5).map(({ industry, count }) => (
                <li key={industry ?? "_null"} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-fg-secondary">{industry ?? "Sin datos"}</span>
                  <span className="text-xs font-semibold tabular-nums text-fg-muted">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {byCargo.length > 0 && (
          <div className="card p-5 space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">Top cargos</h3>
            <ul className="divide-y divide-stroke-soft">
              {byCargo.slice(0, 5).map(({ cargo, count }) => (
                <li key={cargo ?? "_null"} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-fg-secondary">{cargo ?? "Sin datos"}</span>
                  <span className="text-xs font-semibold tabular-nums text-fg-muted">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
