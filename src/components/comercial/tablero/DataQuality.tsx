"use client";

import type { DataQualityReport } from "@/lib/comercial/dashboard-kpis";

interface Props {
  quality: DataQualityReport;
}

// ─── SVG Ring Gauge ───────────────────────────────────────────────────────────

function RingGauge({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 48, cx = 60, cy = 60;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  return (
    <div className="flex-shrink-0 self-center">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={13}
          stroke="currentColor" className="text-fg-primary/8" />
        <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={13}
          stroke={color}
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeDashoffset={circ * 0.25}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
        <text x={cx} y={cy - 4} textAnchor="middle"
          style={{ fontSize: 22, fontWeight: 800, fill: "var(--fg-primary)" }}>
          {score}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle"
          style={{ fontSize: 9, fill: "var(--fg-muted)" }}>
          / 100
        </text>
        <text x={cx} y={cy + 26} textAnchor="middle"
          style={{ fontSize: 9, fontWeight: 600, fill: color }}>
          {label.toUpperCase()}
        </text>
      </svg>
    </div>
  );
}

// ─── External link icon ───────────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────────

export function DataQuality({ quality }: Props) {
  if (quality.total === 0) {
    return (
      <section id="data-quality-block" className="space-y-4">
        <header>
          <h2 className="text-xl font-bold text-fg-primary">Calidad de datos CRM</h2>
        </header>
        <div className="card card-pad">
          <p className="text-sm text-fg-muted">No hay oportunidades activas en el CRM.</p>
        </div>
      </section>
    );
  }

  const score = Math.round(quality.score);
  const incompleteCount = quality.incomplete.length;
  const completeCount = quality.total - incompleteCount;

  const gaugeColor =
    score >= 80 ? "var(--status-success)" :
    score >= 50 ? "var(--status-warning)" :
    "var(--status-danger)";

  const labelText =
    score >= 80 ? "Excelente" :
    score >= 65 ? "Bueno" :
    score >= 50 ? "Regular" :
    "Crítico";

  return (
    <section id="data-quality-block" className="space-y-4">
      <header>
        <h2 className="text-xl font-bold text-fg-primary">Calidad de datos CRM</h2>
        <p className="text-sm text-fg-muted">
          {quality.total} oportunidades activas · {incompleteCount} con campos faltantes
        </p>
      </header>

      {/* Ring + completeness bars */}
      <div className="card card-pad">
        <div className="flex flex-col lg:flex-row gap-6 items-start">

          {/* Ring gauge */}
          <div className="flex flex-col items-center gap-1 self-center">
            <RingGauge score={score} label={labelText} color={gaugeColor} />
            <p className="text-xs text-fg-muted text-center max-w-[120px] leading-snug">
              {score >= 80
                ? "Forecast de alta confiabilidad."
                : score >= 50
                ? "Completar datos mejorará el análisis."
                : "Datos críticos faltantes."}
            </p>
            {incompleteCount > 0 && (
              <a
                href="#data-quality-incomplete"
                className="text-xs text-fg-brand hover:underline mt-1"
              >
                Ver {incompleteCount} incompletas →
              </a>
            )}
          </div>

          {/* Field completeness */}
          <div className="flex-1 min-w-0 space-y-3">
            <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
              Completitud por campo — haga clic para ver las oportunidades afectadas
            </p>
            <div className="space-y-2.5">
              {quality.completeness.map((f) => {
                const missing = quality.total - f.filled;
                return (
                  <div key={f.field} className="flex items-center gap-3">
                    <span className="text-sm text-fg-secondary w-36 shrink-0 truncate">{f.label}</span>
                    <div className="flex-1 h-2 bg-fg-primary/10 rounded-full overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${
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
                      >
                        {missing} sin dato →
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
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
                  <tr key={item.deal_id} className="border-b border-stroke-soft last:border-0 hover:bg-fg-primary/5 transition-colors">
                    <td className="py-2.5 px-2 font-medium text-fg-primary truncate max-w-[200px]">{item.title}</td>
                    <td className="py-2.5 px-2">
                      <div className="flex flex-wrap gap-1">
                        {item.missing.map((m) => (
                          <span key={m} className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-status-danger/10 text-status-danger">
                            {m}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <a href={item.href} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-fg-brand hover:underline font-medium">
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
