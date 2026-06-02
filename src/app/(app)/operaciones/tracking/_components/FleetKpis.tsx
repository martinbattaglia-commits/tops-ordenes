"use client";

import { Icon, type IconName } from "@/components/Icon";

/**
 * KPIs ejecutivos de la flota (live). nx-surface = informativos, sin hover.
 * Mismo lenguaje visual que el resto de los dashboards Nexus.
 */

export interface FleetCounts {
  total: number;
  moving: number;
  idle: number;
  offline: number;
}

const TONE_CLASS: Record<string, string> = {
  brand: "bg-tops-red/10 text-tops-red",
  success: "bg-status-success/10 text-status-success",
  warning: "bg-status-warning/10 text-status-warning",
  muted: "bg-bg-surface-alt text-fg-muted",
};

export function FleetKpis({ counts }: { counts: FleetCounts }) {
  const kpis: { label: string; value: number; icon: IconName; tone: keyof typeof TONE_CLASS }[] = [
    { label: "Vehículos", value: counts.total, icon: "truck", tone: "brand" },
    { label: "En movimiento", value: counts.moving, icon: "trend-up", tone: "success" },
    { label: "Detenidos", value: counts.idle, icon: "pause", tone: "warning" },
    { label: "Offline", value: counts.offline, icon: "moon", tone: "muted" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 nx-stagger">
      {kpis.map((k, i) => (
        <div
          key={k.label}
          className="card nx-surface p-4 flex items-center gap-3"
          style={{ animationDelay: `${i * 45}ms` }}
        >
          <div className={`w-10 h-10 rounded-lg grid place-items-center flex-shrink-0 ${TONE_CLASS[k.tone]}`}>
            <Icon name={k.icon} size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-black leading-none tabular-nums">{k.value}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted mt-1">
              {k.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
