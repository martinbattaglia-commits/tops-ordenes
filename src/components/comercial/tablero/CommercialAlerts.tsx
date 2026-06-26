"use client";

import { useTableroFilters, scrollToSection } from "@/hooks/useTableroFilters";
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

// ─── Determine filter to apply for a given alert label ───────────────────────

function resolveFilter(label: string): Partial<Record<string, unknown>> {
  const l = label.toLowerCase();
  if (l.includes("sin movimiento") || l.includes("sin acción") || l.includes("sin próxima")) {
    return { no_action: true };
  }
  if (l.includes("vencid") || l.includes("reactivar")) {
    return { overdue: true };
  }
  if (l.includes("alto valor") || l.includes("alta probabilidad")) {
    return { score: "hot" };
  }
  // default: stagnant
  return { stagnant: true };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CommercialAlertsProps {
  groups: AlertGroup[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommercialAlerts({ groups }: CommercialAlertsProps) {
  const { applyFilter } = useTableroFilters();

  const handleClearAndScroll = () => {
    applyFilter({});
    scrollToSection("opportunities-table");
  };

  if (groups.length === 0) {
    return (
      <div className="card card-pad">
        <div className="mb-3 text-sm font-semibold text-fg-primary">Alertas comerciales</div>
        <p className="text-sm text-fg-muted">Sin alertas comerciales — todo en orden.</p>
        <button
          onClick={handleClearAndScroll}
          className="mt-3 text-xs text-fg-brand hover:underline cursor-pointer"
        >
          Ver todas las oportunidades →
        </button>
      </div>
    );
  }

  const ordered = SEVERITY_ORDER.flatMap((sev) => {
    const g = groups.find((g) => g.severity === sev);
    return g && g.items.length > 0 ? [g] : [];
  });

  const handleItemClick = (label: string) => {
    const partial = resolveFilter(label);
    applyFilter(partial as Parameters<typeof applyFilter>[0]);
    scrollToSection("opportunities-table");
  };

  return (
    <div className="card card-pad flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-fg-primary">Alertas comerciales</div>
        <button
          onClick={handleClearAndScroll}
          className="text-xs text-fg-brand hover:underline cursor-pointer"
        >
          Ver en tabla →
        </button>
      </div>

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
                  className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-surface-alt cursor-pointer group"
                  style={{ animationDelay: `${i * 40}ms` }}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleItemClick(it.label)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleItemClick(it.label);
                    }
                  }}
                  title="Haz clic para filtrar en la tabla"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg-primary group-hover:text-fg-brand transition-colors">
                      {it.cliente}
                    </span>
                    <span className="text-xs text-fg-muted">{it.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-sm font-semibold tabular-nums text-fg-secondary">
                      {fmt(it.amount)}
                    </span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 text-fg-muted group-hover:text-fg-brand transition-colors"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
