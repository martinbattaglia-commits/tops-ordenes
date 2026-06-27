"use client";

import { Kpis } from "@/lib/comercial/dashboard-kpis";
import { useTableroFilters } from "@/hooks/useTableroFilters";

interface Props {
  kpis: Kpis;
}

const fmt = (n: number): string =>
  Math.abs(n) >= 1_000_000
    ? "$ " + (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

interface MiniCardProps {
  label: string;
  value: string | number;
  highlight?: "danger" | "warning" | "success" | "info" | "none";
  onClick?: () => void;
}

function MiniCard({ label, value, highlight = "none", onClick }: MiniCardProps) {
  const valueClass =
    highlight === "danger"
      ? "text-status-danger"
      : highlight === "warning"
      ? "text-status-warning"
      : highlight === "success"
      ? "text-status-success"
      : highlight === "info"
      ? "text-status-info"
      : "text-fg-primary";

  return (
    <div
      className={[
        "rounded-lg border border-border p-3 flex flex-col gap-1 transition-colors",
        onClick ? "cursor-pointer hover:border-fg-brand/40" : "",
      ]
        .join(" ")
        .trim()}
      onClick={onClick}
    >
      <span className="text-xs text-fg-muted uppercase tracking-wide leading-none">
        {label}
      </span>
      <span className={`text-xl font-bold leading-tight ${valueClass}`}>{value}</span>
    </div>
  );
}

export function PipelineStatus({ kpis }: Props) {
  const { applyFilter } = useTableroFilters();

  const goActive = () => applyFilter({ status: "active" });
  const goOverdue = () => applyFilter({ status: "active", overdue: true });
  const goNoAction = () => applyFilter({ status: "active", no_action: true });
  const goStagnant = () => applyFilter({ status: "active", stagnant: true });

  return (
    <div className="card card-pad">
      <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wide mb-3">
        Estado del Pipeline
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MiniCard
          label="Oportunidades abiertas"
          value={kpis.liveCount}
          onClick={goActive}
        />
        <MiniCard
          label="Importe abierto"
          value={fmt(kpis.activePipeline)}
          onClick={goActive}
        />
        <MiniCard
          label="Forecast 30d"
          value={fmt(kpis.nextCloseValue)}
          highlight="info"
        />
        <MiniCard
          label="Vencidas"
          value={kpis.overdueCount}
          highlight={kpis.overdueCount > 0 ? "danger" : "none"}
          onClick={kpis.overdueCount > 0 ? goOverdue : undefined}
        />
        <MiniCard
          label="Sin próxima actividad"
          value={kpis.noActionCount}
          highlight={kpis.noActionCount > 0 ? "danger" : "none"}
          onClick={kpis.noActionCount > 0 ? goNoAction : undefined}
        />
        <MiniCard
          label="Estancadas"
          value={kpis.stagnantCount}
          highlight={kpis.stagnantCount > 0 ? "warning" : "none"}
          onClick={kpis.stagnantCount > 0 ? goStagnant : undefined}
        />
      </div>
    </div>
  );
}
