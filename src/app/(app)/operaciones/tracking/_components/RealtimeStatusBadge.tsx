"use client";

import type { FleetRealtimeStatus } from "@/lib/tracking/realtime/useFleetRealtime";

/**
 * Métrica visible de estado de conexión Realtime (observabilidad operativa).
 *
 * Más que el live-dot: muestra el estado textual explícito y, como diagnóstico,
 * el tiempo desde el último evento recibido. Pensado para que operaciones
 * detecte de un vistazo si el stream de posiciones está vivo.
 */

interface StatusMeta {
  label: string;
  dot: string;
  chip: string;
  pulse: boolean;
}

const STATUS_META: Record<FleetRealtimeStatus, StatusMeta> = {
  live: {
    label: "Conectado",
    dot: "bg-status-success",
    chip: "bg-status-success/10 text-status-success border-status-success/20",
    pulse: true,
  },
  connecting: {
    label: "Reconectando",
    dot: "bg-status-warning",
    chip: "bg-status-warning/10 text-status-warning border-status-warning/20",
    pulse: false,
  },
  error: {
    label: "Desconectado",
    dot: "bg-status-danger",
    chip: "bg-status-danger/10 text-status-danger border-status-danger/20",
    pulse: false,
  },
  disabled: {
    label: "Sin realtime",
    dot: "bg-fg-muted/50",
    chip: "bg-bg-surface-alt text-fg-muted border-stroke-soft",
    pulse: false,
  },
};

function sinceLabel(lastEventMs: number | null, nowMs: number): string | null {
  if (lastEventMs == null) return null;
  const s = Math.max(0, Math.round((nowMs - lastEventMs) / 1000));
  if (s < 60) return `último evento hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `último evento hace ${m} min`;
  const h = Math.round(m / 60);
  return `último evento hace ${h} h`;
}

interface RealtimeStatusBadgeProps {
  status: FleetRealtimeStatus;
  lastEventMs: number | null;
  nowMs: number;
}

export function RealtimeStatusBadge({ status, lastEventMs, nowMs }: RealtimeStatusBadgeProps) {
  const meta = STATUS_META[status];
  const since = sinceLabel(lastEventMs, nowMs);

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 ${meta.chip}`}
      role="status"
      aria-live="polite"
      title={`Realtime: ${meta.label}${since ? ` · ${since}` : ""}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${meta.pulse ? "nx-live-dot" : ""}`} />
      <span className="text-[11px] font-semibold uppercase tracking-wider">{meta.label}</span>
      {since && (
        <span className="text-[10px] font-medium text-fg-muted normal-case tracking-normal hidden sm:inline">
          · {since}
        </span>
      )}
    </div>
  );
}
