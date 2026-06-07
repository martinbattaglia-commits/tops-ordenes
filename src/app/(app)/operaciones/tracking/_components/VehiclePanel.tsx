"use client";

import { Icon } from "@/components/Icon";
import { MOTION_TONE, type LiveVehicle } from "@/lib/tracking/live";

/**
 * Panel lateral flotante (glassmorphism) con el detalle del vehículo
 * seleccionado. Entra/sale con transición CSS (translate-x), sin Framer.
 * Si no hay vehículo seleccionado, se desliza fuera de pantalla.
 */

function formatRelative(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
}

interface VehiclePanelProps {
  vehicle: LiveVehicle | null;
  nowMs: number;
  onClose: () => void;
}

export function VehiclePanel({ vehicle, nowMs, onClose }: VehiclePanelProps) {
  const open = vehicle !== null;
  const tone = vehicle ? MOTION_TONE[vehicle.motion] : MOTION_TONE.offline;
  const pos = vehicle?.last_position ?? null;

  return (
    <div
      className={`pointer-events-none absolute inset-y-3 right-3 z-10 w-[300px] max-w-[calc(100%-1.5rem)] transition-transform duration-300 ease-out ${
        open ? "translate-x-0" : "translate-x-[calc(100%+1.5rem)]"
      }`}
      aria-hidden={!open}
    >
      <div className="pointer-events-auto h-full overflow-y-auto rounded-xl border border-stroke-soft bg-bg-surface/80 backdrop-blur-xl shadow-2xl">
        {vehicle && (
          <div className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="eyebrow-tiny">{vehicle.type ?? "Vehículo"}</div>
                <h3 className="text-base font-black text-fg-brand leading-tight truncate">
                  {vehicle.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="nx-interactive w-7 h-7 grid place-items-center rounded-md text-fg-muted hover:text-fg-primary flex-shrink-0"
                aria-label="Cerrar panel"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <div
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md ${tone.text}`}
              style={{ background: `${tone.hex}1a` }}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
              {tone.label}
            </div>

            <dl className="space-y-2.5">
              <Row icon="user" label="Chofer" value={vehicle.driver_name ?? "—"} />
              <Row
                icon="bolt"
                label="Velocidad"
                value={pos?.speed != null ? `${Math.round(pos.speed)} km/h` : "—"}
              />
              <Row
                icon="trend-up"
                label="Batería"
                value={pos?.battery != null ? `${pos.battery}%` : "—"}
              />
              <Row
                icon="clock"
                label="Última comunicación"
                value={pos ? formatRelative(pos.recorded_at, nowMs) : "Sin datos"}
              />
              <Row
                icon="pin"
                label="Ubicación"
                value={
                  pos
                    ? `${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}`
                    : "Sin posición"
                }
                mono
              />
            </dl>

            {vehicle.plate && (
              <div className="pt-2 border-t border-stroke-soft text-[11px] text-fg-muted">
                Patente <span className="font-mono text-fg-secondary">{vehicle.plate}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  mono,
}: {
  icon: "user" | "bolt" | "trend-up" | "clock" | "pin";
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-7 h-7 rounded-md bg-bg-surface-alt text-fg-muted grid place-items-center flex-shrink-0">
        <Icon name={icon} size={14} />
      </span>
      <div className="min-w-0">
        <dt className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</dt>
        <dd className={`text-sm font-semibold text-fg-primary ${mono ? "font-mono text-xs" : ""}`}>
          {value}
        </dd>
      </div>
    </div>
  );
}
