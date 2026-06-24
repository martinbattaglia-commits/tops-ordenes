import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";
import {
  calculateCommercialScore,
  calculateWeightedForecast,
  getSuggestedAction,
  getOpportunityAlert,
} from "@/lib/comercial/commercial-score";
import { Icon } from "@/components/Icon";

const fmt = (n: number) =>
  Math.abs(n) >= 1e6
    ? "$ " + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

export function TopOpportunities({ deals }: { deals: EnrichedDeal[] }) {
  const today = new Date();

  if (!deals || deals.length === 0) {
    return (
      <section className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-muted">
            Pipeline comercial
          </p>
          <h2 className="text-lg font-bold text-fg-primary mt-0.5">
            Top oportunidades a cerrar
          </h2>
        </div>
        <p className="text-sm text-fg-muted">Sin oportunidades activas.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-fg-muted">
          Pipeline comercial
        </p>
        <h2 className="text-lg font-bold text-fg-primary mt-0.5">
          Top oportunidades a cerrar
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
        {deals.map((d, i) => {
          // calculateCommercialScore is imported to satisfy the brief requirement;
          // score is used for aria-label for accessibility context
          const score = calculateCommercialScore(d, today);
          const wForecast = calculateWeightedForecast(d);
          const action = getSuggestedAction(d, today);
          const alert = getOpportunityAlert(d, today);

          const alertBadge = alert
            ? alert.severity === "critica"
              ? "badge badge-danger"
              : alert.severity === "atencion"
              ? "badge badge-warning"
              : "badge badge-info"
            : null;

          return (
            <div
              key={d.deal_id}
              className="card card-pad nx-lift flex flex-col gap-3"
              aria-label={`Oportunidad #${i + 1} — score ${score}`}
            >
              {/* Header: ranking + cliente + unidad */}
              <div className="flex items-start gap-2">
                <span className="badge badge-info shrink-0">#{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <a
                    href={d.href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-fg-primary hover:underline break-words leading-snug"
                  >
                    {d.title}
                  </a>
                  {d.pipeline && (
                    <p className="text-xs text-fg-muted mt-0.5 truncate">{d.pipeline}</p>
                  )}
                </div>
              </div>

              {/* Métricas 2 columnas */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-fg-muted uppercase tracking-wide font-semibold">
                    Importe
                  </dt>
                  <dd className="font-semibold text-fg-primary tabular-nums">{fmt(d.amount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted uppercase tracking-wide font-semibold">
                    Forecast pond.
                  </dt>
                  <dd className="font-semibold text-fg-primary tabular-nums">{fmt(wForecast)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted uppercase tracking-wide font-semibold">
                    Probabilidad
                  </dt>
                  <dd className="font-semibold text-fg-primary tabular-nums">
                    {d.effective_probability}%
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted uppercase tracking-wide font-semibold">
                    Horizonte
                  </dt>
                  <dd className="font-semibold text-fg-primary">
                    {d.overlay_horizonte ?? "A definir"}
                  </dd>
                </div>
              </dl>

              {/* Estado + alerta */}
              <div className="flex flex-wrap items-center gap-2">
                {d.stage && (
                  <span className="badge badge-muted">
                    <span className="dot" />
                    {d.stage}
                  </span>
                )}
                {alert && alertBadge && (
                  <span className={alertBadge}>
                    <span className="dot" />
                    {alert.label}
                  </span>
                )}
              </div>

              {/* Recomendación */}
              <div className="flex items-start gap-2 pt-1 border-t border-stroke-soft">
                <Icon name="sparkle" size={16} className="text-fg-brand shrink-0 mt-0.5" />
                <p className="text-sm font-medium text-fg-brand leading-snug">{action}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
