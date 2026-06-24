import { Icon } from "@/components/Icon";
import type { Kpis } from "@/lib/comercial/dashboard-kpis";
import type { SyncStatus as SyncStatusData } from "@/lib/comercial/dashboard-data";

interface Props {
  syncStatus: SyncStatusData | null;
  lastSync: string | null;
  kpis: Kpis;
}

export function SyncStatus({ syncStatus, lastSync, kpis }: Props) {
  const lastSyncLabel = lastSync
    ? new Date(lastSync).toLocaleString("es-AR")
    : "—";

  if (!syncStatus) {
    return (
      <div className="card card-pad">
        <div className="flex items-center gap-2 mb-2">
          <Icon name="refresh" size={14} />
          <span className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">
            Estado de sincronización
          </span>
        </div>
        <p className="text-sm text-fg-muted">
          Todavía no se registró una sincronización.
        </p>
      </div>
    );
  }

  const items: { label: string; value: string | number }[] = [
    { label: "Fuente", value: "Clientify API" },
    { label: "Última sync", value: lastSyncLabel },
    { label: "Deals importados", value: syncStatus.dealsSynced ?? 0 },
    { label: "Pipelines", value: syncStatus.pipelines ?? 0 },
    { label: "Vencidas", value: kpis.overdueCount },
    { label: "Errores", value: syncStatus.errors ?? 0 },
  ];

  return (
    <div className="card card-pad flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon name="refresh" size={14} />
        <span className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">
          Estado de sincronización
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-0.5">
            <span className="text-xs text-fg-muted">{item.label}</span>
            <span className="text-sm font-medium text-fg-primary tabular-nums">
              {item.value}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs text-fg-muted leading-relaxed">
        Pipeline calculado sobre {kpis.count} oportunidades; el forecast
        pondera solo las vivas y excluye vencidas, ganadas y perdidas.
      </p>

      {syncStatus.errors > 0 && syncStatus.message && (
        <div className="flex items-start gap-2">
          <span className="badge badge-danger">
            <span className="dot" />
            {syncStatus.message}
          </span>
        </div>
      )}
    </div>
  );
}
