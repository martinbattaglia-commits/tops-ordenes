"use client";

import type { QualificationSummary } from "@/lib/prospeccion/read/qualification-data";

interface QualificationDashboardProps {
  summary: QualificationSummary;
  onQualifyAll?: () => void;
  isQualifying?: boolean;
  processingTimeMs?: number;
}

interface StatCardProps {
  label: string;
  value: number | string;
  colorClass?: string;
}

function StatCard({ label, value, colorClass }: StatCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colorClass ?? "text-gray-900"}`}>{value}</p>
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
      {/* Header con CTA de calificación */}
      {onQualifyAll && totalScoreado === 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-800">
              {totalImported > 0
                ? `Hay ${totalImported} prospectos importados sin calificar.`
                : "Importá prospectos para comenzar la calificación."}
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              El motor de IA asigna score 0-100 y decide import / review / discard.
            </p>
          </div>
          <button
            onClick={onQualifyAll}
            disabled={isQualifying || totalImported === 0}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Calificando prospectos…
        </div>
      )}

      {processingTimeMs !== undefined && (
        <p className="text-xs text-gray-500">
          Procesado en {(processingTimeMs / 1000).toFixed(1)}s
        </p>
      )}

      {/* Grid de stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Importados" value={totalImported} />
        <StatCard label="Calificados" value={totalScoreado} />
        <StatCard
          label="🟢 Excelentes"
          value={decisionCounts.import}
          colorClass="text-emerald-700"
        />
        <StatCard
          label="🟡 Para revisar"
          value={decisionCounts.review}
          colorClass="text-amber-700"
        />
        <StatCard
          label="🔴 Descartados"
          value={decisionCounts.discard}
          colorClass="text-red-700"
        />
        <StatCard
          label="Score promedio"
          value={avgScore > 0 ? avgScore.toFixed(1) : "—"}
          colorClass="text-blue-700"
        />
        <StatCard
          label="Aprobados"
          value={totalAprobado}
          colorClass="text-emerald-700"
        />
      </div>

      {/* Distribución por decisión — barras horizontales */}
      {totalDecisions > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Distribución por decisión</h3>
          {byDecision.map(({ decision, count }) => {
            const pct = Math.round((count / totalDecisions) * 100);
            const barColor =
              decision === "import"
                ? "bg-emerald-500"
                : decision === "review"
                  ? "bg-amber-400"
                  : decision === "discard"
                    ? "bg-red-400"
                    : "bg-gray-300";
            const label =
              decision === "import"
                ? "🟢 Excelente"
                : decision === "review"
                  ? "🟡 Revisar"
                  : decision === "discard"
                    ? "🔴 Descartar"
                    : decision;
            return (
              <div key={decision} className="space-y-1">
                <div className="flex justify-between text-xs text-gray-600">
                  <span>{label}</span>
                  <span className="font-medium">
                    {count} ({pct}%)
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-100">
                  <div
                    className={`h-2 rounded-full transition-all ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Por industria */}
        {byIndustry.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-700">Top industrias</h3>
            <ul className="divide-y divide-gray-100">
              {byIndustry.slice(0, 5).map(({ industry, count }) => (
                <li
                  key={industry ?? "_null"}
                  className="flex items-center justify-between py-1.5 text-sm"
                >
                  <span className="text-gray-700">{industry ?? "Sin datos"}</span>
                  <span className="text-xs font-medium text-gray-500">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Por cargo */}
        {byCargo.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-700">Top cargos</h3>
            <ul className="divide-y divide-gray-100">
              {byCargo.slice(0, 5).map(({ cargo, count }) => (
                <li
                  key={cargo ?? "_null"}
                  className="flex items-center justify-between py-1.5 text-sm"
                >
                  <span className="text-gray-700">{cargo ?? "Sin datos"}</span>
                  <span className="text-xs font-medium text-gray-500">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
