"use client";

import type { DataQualityReport } from "@/lib/comercial/dashboard-kpis";

interface Props {
  quality: DataQualityReport;
}

const SCORE_CONFIG = {
  excelente: { label: "Excelente", icon: "🟢", color: "text-status-success", bg: "bg-status-success/10 border-status-success/30" },
  bueno:     { label: "Bueno",     icon: "🟡", color: "text-status-warning", bg: "bg-status-warning/10 border-status-warning/30" },
  regular:   { label: "Regular",   icon: "🟠", color: "text-orange-500",     bg: "bg-orange-500/10 border-orange-500/30" },
  critico:   { label: "Crítico",   icon: "🔴", color: "text-status-danger",  bg: "bg-status-danger/10 border-status-danger/30" },
} as const;

function ExternalLinkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function DataQuality({ quality }: Props) {
  if (quality.total === 0) {
    return (
      <section id="data-quality-block" className="space-y-4">
        <header>
          <h2 className="text-xl font-bold text-fg-primary">Calidad de datos CRM</h2>
          <p className="text-sm text-fg-muted">Completitud de campos clave en oportunidades vivas</p>
        </header>
        <div className="card card-pad">
          <p className="text-sm text-fg-muted">No hay oportunidades activas en el CRM.</p>
        </div>
      </section>
    );
  }

  const cfg = SCORE_CONFIG[quality.scoreLabel];
  const incompleteCount = quality.incomplete.length;
  const completeCount = quality.total - incompleteCount;

  return (
    <section id="data-quality-block" className="space-y-4">
      <header>
        <h2 className="text-xl font-bold text-fg-primary">Calidad de datos CRM</h2>
        <p className="text-sm text-fg-muted">
          {quality.total} oportunidades activas · {incompleteCount} con campos faltantes
        </p>
      </header>

      {/* Score card */}
      <div className={`card card-pad border ${cfg.bg} flex items-center gap-4`}>
        <div className="shrink-0 text-center">
          <div className={`text-4xl font-black tabular-nums ${cfg.color}`}>{quality.score}</div>
          <div className="text-xs text-fg-muted mt-0.5">/ 100</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${cfg.color}`}>
            {cfg.icon} {cfg.label} — CRM Data Quality Score
          </div>
          {quality.score < 85 ? (
            <p className="text-xs text-fg-muted mt-0.5">
              El Forecast Comercial presenta una confiabilidad del <strong>{quality.score}%</strong> debido a
              la ausencia de información crítica en{" "}
              <strong className="text-fg-secondary">{incompleteCount} oportunidades</strong> activas.{" "}
              Completar los campos marcados en Clientify mejora la precisión de todas las proyecciones.
            </p>
          ) : (
            <p className="text-xs text-fg-muted mt-0.5">
              {completeCount} de {quality.total} oportunidades tienen todos los campos completos.
              El Forecast puede considerarse de alta confiabilidad.
            </p>
          )}
        </div>
        {incompleteCount > 0 && (
          <a
            href="#data-quality-incomplete"
            className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold bg-fg-brand/10 text-fg-brand hover:bg-fg-brand/20 transition-colors"
          >
            Ver {incompleteCount} incompletas ↓
          </a>
        )}
      </div>

      {/* Field completeness */}
      <div className="card card-pad space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Completitud por campo — haga clic para ver las oportunidades afectadas
        </p>

        <div className="space-y-3">
          {quality.completeness.map((f) => {
            const missing = quality.total - f.filled;
            return (
              <div key={f.field} className="flex items-center gap-3">
                <span className="text-sm text-fg-secondary w-36 shrink-0 truncate">{f.label}</span>
                <div className="flex-1 h-2 bg-fg-primary/10 rounded-full overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      f.pct >= 80 ? "bg-status-success" : f.pct >= 50 ? "bg-status-warning" : "bg-status-danger"
                    }`}
                    style={{ width: `${f.pct}%` }}
                  />
                </div>
                <span className="text-xs text-fg-muted w-14 text-right tabular-nums shrink-0">
                  {f.filled}/{quality.total}
                </span>
                <span
                  className={`text-sm font-semibold w-10 text-right tabular-nums shrink-0 ${
                    f.pct >= 80 ? "text-status-success" : f.pct >= 50 ? "text-status-warning" : "text-status-danger"
                  }`}
                >
                  {Math.round(f.pct)}%
                </span>
                {missing > 0 && (
                  <a
                    href="#data-quality-incomplete"
                    className="shrink-0 text-xs text-fg-brand hover:underline tabular-nums w-20 text-right"
                    title={`Ver las ${missing} oportunidades sin "${f.label}"`}
                  >
                    {missing} sin dato →
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Incomplete deals */}
      {quality.incomplete.length > 0 ? (
        <div id="data-quality-incomplete" className="card card-pad space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Oportunidades con datos incompletos ({quality.incomplete.length})
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-stroke-soft text-xs text-fg-muted uppercase tracking-wide">
                  <th className="py-2 px-2 text-left">Oportunidad</th>
                  <th className="py-2 px-2 text-left">Campos faltantes</th>
                  <th className="py-2 px-2 text-center w-16">Completar</th>
                </tr>
              </thead>
              <tbody>
                {quality.incomplete.map((item) => (
                  <tr
                    key={item.deal_id}
                    className="border-b border-stroke-soft last:border-0 hover:bg-fg-primary/5 transition-colors"
                  >
                    <td className="py-2.5 px-2 font-medium text-fg-primary truncate max-w-[200px]">
                      {item.title}
                    </td>
                    <td className="py-2.5 px-2">
                      <div className="flex flex-wrap gap-1">
                        {item.missing.map((m) => (
                          <span
                            key={m}
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-status-danger/10 text-status-danger"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-fg-brand hover:underline font-medium"
                        title="Completar en Clientify"
                      >
                        <ExternalLinkIcon />
                        <span className="hidden sm:inline">Editar</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card card-pad">
          <p className="text-sm text-status-success font-medium">
            Todos los campos están completos en las oportunidades activas. ✓
          </p>
        </div>
      )}
    </section>
  );
}
