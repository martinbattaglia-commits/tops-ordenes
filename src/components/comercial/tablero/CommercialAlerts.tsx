import type { AlertGroup } from "@/lib/comercial/dashboard-insights";
import { Icon } from "@/components/Icon";

const fmt = (n: number) => {
  const abs = Math.abs(n || 0);
  if (abs >= 1e6)
    return "$ " + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  return "$ " + Math.round(n || 0).toLocaleString("es-AR");
};

const SEVERITY_ORDER: AlertGroup["severity"][] = ["critica", "atencion", "informativa"];

const SEVERITY_META: Record<
  AlertGroup["severity"],
  { label: string; icon: string; headerClass: string; wrapperClass: string; dotClass: string }
> = {
  critica: {
    label: "Críticas",
    icon: "bell",
    headerClass: "text-status-danger",
    wrapperClass:
      "rounded-lg border border-[#C90812]/30 bg-[#C90812]/5 ring-1 ring-[#C90812]/20",
    dotClass: "bg-status-danger",
  },
  atencion: {
    label: "Atención",
    icon: "clock",
    headerClass: "text-status-warning",
    wrapperClass:
      "rounded-lg border border-yellow-400/30 bg-yellow-400/5 ring-1 ring-yellow-400/20",
    dotClass: "bg-status-warning",
  },
  informativa: {
    label: "Informativas",
    icon: "sparkle",
    headerClass: "text-status-info",
    wrapperClass:
      "rounded-lg border border-[#185FA5]/20 bg-[#185FA5]/5 ring-1 ring-[#185FA5]/10",
    dotClass: "bg-status-info",
  },
};

export function CommercialAlerts({ groups }: { groups: AlertGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="card card-pad">
        <div className="mb-3 text-sm font-semibold text-fg-primary">Alertas comerciales</div>
        <p className="text-sm text-fg-muted">Sin alertas comerciales — todo en orden.</p>
      </div>
    );
  }

  const ordered = SEVERITY_ORDER.flatMap((sev) => {
    const g = groups.find((g) => g.severity === sev);
    return g && g.items.length > 0 ? [g] : [];
  });

  return (
    <div className="card card-pad flex flex-col gap-4">
      <div className="text-sm font-semibold text-fg-primary">Alertas comerciales</div>

      {ordered.map((group) => {
        const meta = SEVERITY_META[group.severity];
        return (
          <div key={group.severity} className={`${meta.wrapperClass} p-3`}>
            {/* Sub-bloque header */}
            <div className={`mb-2 flex items-center gap-1.5 ${meta.headerClass}`}>
              <Icon name={meta.icon as Parameters<typeof Icon>[0]["name"]} size={14} />
              <span className="text-xs font-semibold uppercase tracking-wide">
                {meta.label}
              </span>
              <span className="ml-auto text-xs font-semibold tabular-nums">
                {group.items.length}
              </span>
            </div>

            {/* Items list */}
            <ul className="flex flex-col gap-1 nx-stagger">
              {group.items.map((it, i) => (
                <li
                  key={`${it.href}-${i}`}
                  className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-surface-alt"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="min-w-0 flex-1">
                    <a
                      href={it.href}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-medium text-fg-primary hover:underline"
                    >
                      {it.cliente}
                    </a>
                    <span className="text-xs text-fg-muted">{it.label}</span>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-fg-secondary">
                    {fmt(it.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
