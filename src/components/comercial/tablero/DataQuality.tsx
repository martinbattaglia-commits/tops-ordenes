"use client";

import type { DataQualityReport } from "@/lib/comercial/dashboard-kpis";

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  quality: DataQualityReport;
}

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

// ─── Component ────────────────────────────────────────────────────────────────

export function DataQuality({ quality }: Props) {
  // Compute avg completeness across all fields
  const avgCompleteness =
    quality.completeness.length > 0
      ? Math.round(
          quality.completeness.reduce((a, f) => a + f.pct, 0) / quality.completeness.length
        )
      : 0;

  if (quality.total === 0) {
    return (
      <section id="data-quality-block" className="space-y-4">
        <header>
          <h2 className="text-xl font-bold text-fg-primary">Calidad de datos CRM</h2>
          <p className="text-sm text-fg-muted">Completitud de campos clave en oportunidades vivas</p>
        </header>
        <div className="card card-pad">
          <p className="text-sm text-fg-muted">No hay oportunidades en el CRM.</p>
        </div>
      </section>
    );
  }

  return (
    <section id="data-quality-block" className="space-y-4">
      <header>
        <h2 className="text-xl font-bold text-fg-primary">Calidad de datos CRM</h2>
        <p className="text-sm text-fg-muted">
          Completitud de campos clave en oportunidades vivas ({quality.total} en total)
        </p>
      </header>

      {/* Warning banner when avg completeness < 80% */}
      {avgCompleteness < 80 && (
        <div className="card card-pad border-l-4 border-status-danger bg-status-danger/5 text-sm text-fg-secondary">
          <p className="font-semibold text-status-danger mb-1">Atención: datos incompletos</p>
          <p>
            Si los datos no están completos, el dashboard puede mentir con elegancia.
            Completar los campos marcados en Clientify mejora la precisión del forecast.
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            Completitud promedio actual: <strong className="text-fg-secondary">{avgCompleteness}%</strong>
          </p>
        </div>
      )}

      {/* Progress bars */}
      <div className="card card-pad space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Completitud por campo
        </p>

        <div className="space-y-3">
          {quality.completeness.map((f) => (
            <div key={f.field} className="flex items-center gap-3">
              {/* Field label */}
              <span className="text-sm text-fg-secondary w-40 shrink-0 truncate">
                {f.label}
              </span>

              {/* Progress bar */}
              <div className="flex-1 h-2 bg-fg-primary/10 rounded-full overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all ${
                    f.pct >= 80
                      ? "bg-status-success"
                      : f.pct >= 50
                      ? "bg-status-warning"
                      : "bg-status-danger"
                  }`}
                  style={{ width: `${f.pct}%` }}
                />
              </div>

              {/* Filled / total */}
              <span className="text-xs text-fg-muted w-14 text-right tabular-nums shrink-0">
                {f.filled}/{quality.total}
              </span>

              {/* Percentage */}
              <span
                className={`text-sm font-semibold w-10 text-right tabular-nums shrink-0 ${
                  f.pct >= 80
                    ? "text-status-success"
                    : f.pct >= 50
                    ? "text-status-warning"
                    : "text-status-danger"
                }`}
              >
                {Math.round(f.pct)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Incomplete deals table */}
      {quality.incomplete.length > 0 ? (
        <div className="card card-pad space-y-3">
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
                    {/* Oportunidad */}
                    <td className="py-2.5 px-2 font-medium text-fg-primary truncate max-w-[200px]">
                      {item.title}
                    </td>

                    {/* Campos faltantes */}
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

                    {/* Completar → link */}
                    <td className="py-2.5 px-2 text-center">
                      <a
                        href={`https://app.clientify.net/deals/${item.deal_id}`}
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
            Todos los campos están completos. ✓
          </p>
        </div>
      )}
    </section>
  );
}
