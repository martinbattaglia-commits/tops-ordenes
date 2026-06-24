import type { QuadrantGroup } from "@/lib/comercial/dashboard-insights";
import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";
import { Icon } from "@/components/Icon";

const fmt = (n: number) =>
  Math.abs(n) >= 1e6
    ? "$ " + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

type QuadrantKey = "alta_prioridad" | "quick_win" | "a_trabajar" | "baja_prioridad";

const QUADRANT_META: Record<
  QuadrantKey,
  {
    icon: string;
    borderClass: string;
    accentClass: string;
    badgeClass: string;
  }
> = {
  alta_prioridad: {
    icon: "shield",
    borderClass: "border-tops-blue-900",
    accentClass: "text-fg-brand",
    badgeClass: "badge badge-info",
  },
  quick_win: {
    icon: "bolt",
    borderClass: "border-status-success",
    accentClass: "text-status-success",
    badgeClass: "badge badge-success",
  },
  a_trabajar: {
    icon: "pen",
    borderClass: "border-status-warning",
    accentClass: "text-status-warning",
    badgeClass: "badge badge-warning",
  },
  baja_prioridad: {
    icon: "clock",
    borderClass: "border-stroke-strong",
    accentClass: "text-fg-muted",
    badgeClass: "badge badge-muted",
  },
};

function QuadrantCard({ q }: { q: QuadrantGroup }) {
  const meta = QUADRANT_META[q.key] ?? QUADRANT_META.baja_prioridad;
  const topDeals: EnrichedDeal[] = q.deals.slice(0, 3);

  return (
    <div
      className={`card card-pad flex flex-col gap-3 border-l-4 ${meta.borderClass}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Icon name={meta.icon as Parameters<typeof Icon>[0]["name"]} size={18} className={meta.accentClass} />
        <span className="font-semibold text-fg-primary">{q.label}</span>
      </div>

      {/* KPIs */}
      <div className="flex items-end gap-4">
        <div>
          <p className="text-3xl font-bold text-fg-primary tabular-nums">{q.count}</p>
          <p className="text-xs text-fg-muted mt-0.5">deals</p>
        </div>
        <div className="mb-0.5">
          <p className="text-sm font-semibold text-fg-secondary tabular-nums">{fmt(q.amount)}</p>
          <p className="text-xs text-fg-muted">monto total</p>
        </div>
      </div>

      {/* Top deals mini-lista */}
      {topDeals.length > 0 ? (
        <ul className="space-y-1.5 border-t border-stroke-soft pt-2">
          {topDeals.map((d) => (
            <li key={d.deal_id} className="flex items-center justify-between gap-2 text-xs">
              <a
                href={d.href}
                target="_blank"
                rel="noreferrer"
                className="text-fg-secondary hover:underline truncate flex-1"
              >
                {d.company_name ?? d.title}
              </a>
              <span className="text-fg-muted tabular-nums shrink-0">
                {fmt(d.amount)} · {d.effective_probability}%
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted border-t border-stroke-soft pt-2">
          Sin oportunidades
        </p>
      )}
    </div>
  );
}

export function PriorityMatrix({ quadrants }: { quadrants: QuadrantGroup[] }) {
  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-fg-muted">
          Priorización
        </p>
        <h2 className="text-lg font-bold text-fg-primary mt-0.5">
          Matriz de prioridad comercial
        </h2>
        <p className="text-xs text-fg-muted mt-1">
          Eje horizontal: probabilidad de cierre · Eje vertical: importe
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {quadrants.map((q) => (
          <QuadrantCard key={q.key} q={q} />
        ))}
      </div>
    </section>
  );
}
