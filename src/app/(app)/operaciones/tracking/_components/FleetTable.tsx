"use client";

import { Icon } from "@/components/Icon";
import { MOTION_TONE, type LiveVehicle } from "@/lib/tracking/live";

/**
 * Tabla de flota en vivo. Filas navegables (nx-row) → seleccionan el vehículo
 * y lo enfocan en el mapa + panel. Empty state cuando no hay vehículos.
 */

// timeZone fijo (zona operativa): sin esto, el SSR (server en UTC) y el CSR
// (browser en ART) formatean distinto → hydration mismatch React #425/#422.
// Fijarla hace que server y cliente produzcan el MISMO string → sin mismatch.
function formatLastComm(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
    : "Sin datos";
}

interface FleetTableProps {
  vehicles: LiveVehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FleetTable({ vehicles, selectedId, onSelect }: FleetTableProps) {
  const total = vehicles.length;

  return (
    <div className="card p-0">
      <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between">
        <div className="text-sm font-bold text-fg-brand">Flota</div>
        <div className="text-[11px] text-fg-muted">
          {total} vehículo{total === 1 ? "" : "s"}
        </div>
      </div>

      {total === 0 ? (
        <div className="p-10 text-center">
          <div className="w-12 h-12 rounded-lg bg-bg-surface-alt text-fg-muted grid place-items-center mx-auto mb-3">
            <Icon name="truck" size={24} />
          </div>
          <div className="text-sm font-semibold text-fg-secondary">Sin vehículos registrados</div>
          <p className="text-xs text-fg-muted mt-1 max-w-md mx-auto">
            Los vehículos se dan de alta con su{" "}
            <code className="font-mono text-[11px]">device_identifier</code> (ID de Traccar
            Client). La gestión desde la UI llega en una fase próxima; por ahora se cargan vía SQL.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted border-b border-stroke-soft">
                <th className="px-4 py-2.5 font-semibold">Vehículo</th>
                <th className="px-4 py-2.5 font-semibold">Chofer</th>
                <th className="px-4 py-2.5 font-semibold">Patente</th>
                <th className="px-4 py-2.5 font-semibold">Velocidad</th>
                <th className="px-4 py-2.5 font-semibold">Batería</th>
                <th className="px-4 py-2.5 font-semibold">Última comunicación</th>
                <th className="px-4 py-2.5 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => {
                const tone = MOTION_TONE[v.motion];
                const selected = v.id === selectedId;
                return (
                  <tr
                    key={v.id}
                    onClick={() => onSelect(v.id)}
                    className={`nx-row cursor-pointer border-b border-stroke-soft/60 last:border-0 ${
                      selected ? "bg-tops-red/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-fg-brand">{v.name}</td>
                    <td className="px-4 py-3 text-fg-secondary">{v.driver_name ?? "—"}</td>
                    <td className="px-4 py-3 text-fg-secondary font-mono text-xs">{v.plate ?? "—"}</td>
                    <td className="px-4 py-3 text-fg-secondary tabular-nums">
                      {v.last_position?.speed != null ? `${Math.round(v.last_position.speed)} km/h` : "—"}
                    </td>
                    <td className="px-4 py-3 text-fg-secondary tabular-nums">
                      {v.last_position?.battery != null ? `${v.last_position.battery}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-fg-muted text-xs">
                      {formatLastComm(v.last_position?.recorded_at ?? null)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${tone.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                        {tone.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
