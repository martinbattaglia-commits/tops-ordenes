import { Icon } from "@/components/Icon";
import type { ActionItem } from "@/lib/comercial/dashboard-insights";

const fmt = (n: number) =>
  Math.abs(n) >= 1e6
    ? "$ " + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

interface Props {
  actions: ActionItem[];
}

const PRIORITY_BADGE: Record<ActionItem["priority"], string> = {
  critica: "badge badge-danger",
  atencion: "badge badge-warning",
  informativa: "badge badge-muted",
};

const PRIORITY_LABEL: Record<ActionItem["priority"], string> = {
  critica: "Crítica",
  atencion: "Atención",
  informativa: "Informativa",
};

export function ActionPlan({ actions }: Props) {
  return (
    <div className="card card-pad">
      <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-3">
        Plan de acción sugerido
      </div>

      {actions.length === 0 ? (
        <p className="text-sm text-fg-muted">No hay acciones sugeridas en este momento.</p>
      ) : (
        <ol className="flex flex-col gap-3 nx-stagger">
          {actions.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-3 border border-stroke-soft rounded-lg p-3 bg-bg-surface-alt nx-lift"
              style={{ animationDelay: String(i * 40) + "ms" }}
            >
              {/* Step number */}
              <span className="badge badge-info shrink-0 min-w-[1.5rem] justify-center font-bold tabular-nums">
                {i + 1}
              </span>

              <div className="flex-1 min-w-0">
                {/* Priority badge + client */}
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={PRIORITY_BADGE[item.priority]}>
                    <span className="dot" />
                    {PRIORITY_LABEL[item.priority]}
                  </span>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-sm text-fg-primary hover:underline truncate"
                  >
                    {item.cliente}
                  </a>
                </div>

                {/* Motivo */}
                <p className="text-xs text-fg-muted mb-1.5 leading-snug">{item.motivo}</p>

                {/* Acción recomendada */}
                <div className="flex items-start gap-1.5">
                  <span className="text-fg-brand mt-0.5 shrink-0">
                    <Icon name="megaphone" size={14} />
                  </span>
                  <span className="text-sm font-medium text-fg-brand leading-snug">
                    {item.accion}
                  </span>
                </div>
              </div>

              {/* Impacto */}
              <div className="text-right shrink-0">
                <div className="text-xs text-fg-muted">Impacto</div>
                <div className="text-sm font-semibold text-fg-primary tabular-nums">
                  {fmt(item.impacto)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
