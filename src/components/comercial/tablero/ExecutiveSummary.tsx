import { Icon } from "@/components/Icon";
import { CountUp } from "@/components/CountUp";
import type { Kpis } from "@/lib/comercial/dashboard-kpis";
import type { Deltas, SyncStatus } from "@/lib/comercial/dashboard-data";

const fmt = (n: number) =>
  Math.abs(n) >= 1e6
    ? "$ " + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

function DeltaChip({ value, label }: { value: number; label: string }) {
  if (value === 0) return null;
  const positive = value > 0;
  return (
    <span
      className={`text-xs font-medium tabular-nums ${positive ? "text-status-success" : "text-status-danger"}`}
    >
      {positive ? "▲" : "▼"} {fmt(Math.abs(value))} {label}
    </span>
  );
}

function SyncBadge({ syncStatus }: { syncStatus: SyncStatus | null }) {
  if (!syncStatus) {
    return (
      <span className="badge badge-muted">
        <span className="dot" />
        Sin datos
      </span>
    );
  }
  if (syncStatus.errors > 0 || syncStatus.status === "error") {
    return (
      <span className="badge badge-danger">
        <span className="dot" />
        Error
      </span>
    );
  }
  if (syncStatus.status === "partial") {
    return (
      <span className="badge badge-warning">
        <span className="dot" />
        Parcial
      </span>
    );
  }
  if (syncStatus.status === "completed") {
    return (
      <span className="badge badge-success">
        <span className="dot" />
        OK
      </span>
    );
  }
  return (
    <span className="badge badge-info">
      <span className="dot" />
      {syncStatus.status}
    </span>
  );
}

interface Card {
  icon: string;
  label: string;
  desc: string;
  colorClass: string;
  content: React.ReactNode;
  extra?: React.ReactNode;
}

export function ExecutiveSummary({
  kpis,
  deltas,
  lastSync,
  syncStatus,
}: {
  kpis: Kpis;
  deltas: Deltas | null;
  lastSync: string | null;
  syncStatus: SyncStatus | null;
}) {
  const lastSyncLabel = lastSync
    ? new Date(lastSync).toLocaleString("es-AR")
    : "—";

  const cards: Card[] = [
    {
      icon: "trend-up",
      label: "Forecast ponderado activo",
      desc: "prob × monto, solo vivos",
      colorClass: "text-status-success",
      content: (
        <div className="kpi-value text-status-success">
          <CountUp to={kpis.forecast} format="currency" />
        </div>
      ),
      extra: deltas ? (
        <DeltaChip value={deltas.forecast} label="vs corte anterior" />
      ) : undefined,
    },
    {
      icon: "trend-up",
      label: "Probabilidad de concreción",
      desc: "ponderada por monto · foto de hoy",
      colorClass: "text-status-info",
      content: (
        <div className="kpi-value text-status-info">
          {kpis.weightedConcretion.toLocaleString("es-AR", {
            maximumFractionDigits: 1,
          })}
          %
        </div>
      ),
    },
    {
      icon: "wallet",
      label: "Pipeline vivo",
      desc: `${kpis.liveCount} oportunidades activas`,
      colorClass: "text-fg-brand",
      content: (
        <div className="kpi-value text-fg-brand">
          <CountUp to={kpis.activePipeline} format="currency" />
        </div>
      ),
      extra: deltas ? (
        <DeltaChip value={deltas.active} label="vs corte anterior" />
      ) : undefined,
    },
    {
      icon: "trend-up",
      label: "Pipeline alta probabilidad",
      desc: "deals con prob ≥ 70%",
      colorClass: "text-status-info",
      content: (
        <div className="kpi-value text-status-info">
          <CountUp to={kpis.highProbPipeline} format="currency" />
        </div>
      ),
    },
    {
      icon: "clock",
      label: "Próximas a cierre",
      desc: "cierre estimado ≤ 30 días",
      colorClass: "text-status-warning",
      content: (
        <div className="kpi-value text-status-warning">
          <CountUp to={kpis.nextCloseValue} format="currency" />
        </div>
      ),
    },
    {
      icon: "bell",
      label: "Oportunidades vencidas",
      desc: `${fmt(kpis.overdueAmount)} a reactivar`,
      colorClass: "text-status-danger",
      content: (
        <div className="kpi-value text-status-danger">
          <CountUp to={kpis.overdueCount} format="int" />
        </div>
      ),
    },
    {
      icon: "clients",
      label: "Sin próxima acción",
      desc: "sin movimiento ≥ 21 días",
      colorClass: "text-status-warning",
      content: (
        <div className="kpi-value text-status-warning">
          <CountUp to={kpis.noActionCount} format="int" />
        </div>
      ),
    },
    {
      icon: "refresh",
      label: "Última sincronización",
      desc: lastSyncLabel,
      colorClass: "text-fg-muted",
      content: (
        <div className="flex flex-col gap-1 mt-1">
          <SyncBadge syncStatus={syncStatus} />
        </div>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-3 md:gap-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
        Resumen ejecutivo comercial
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 nx-stagger">
        {cards.map((card, i) => (
          <div
            key={card.label}
            className="card card-pad nx-lift flex flex-col gap-2"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="flex items-center gap-2">
              <Icon name={card.icon as Parameters<typeof Icon>[0]["name"]} size={16} />
              <span className="kpi-label">{card.label}</span>
            </div>

            <div className="kpi">{card.content}</div>

            {card.extra && <div className="mt-0.5">{card.extra}</div>}

            <p className="text-xs text-fg-muted leading-snug">{card.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
