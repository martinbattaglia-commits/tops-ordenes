// Nexus Link · Centro de Incidentes (F4.2) — lista de gestión.
// Server component: filtros por GET (estado/severidad/sector), orden crítica-primero.
// Gate connect.view heredado del layout /connect. Escrituras: solo vía RPCs 0165.

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { listIncidents, type IncidentFilters } from "@/lib/connect/read/incidents-data";
import {
  INCIDENT_SEVERITIES, INCIDENT_SEVERITY_LABELS, INCIDENT_STATUSES, INCIDENT_STATUS_LABELS,
  type IncidentSeverity, type IncidentStatus,
} from "@/lib/connect/types";
import { timeAgo } from "@/lib/connect/format";
import { SeverityChip, StatusChip } from "../_components/IncidentChips";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Incidentes" };

function parseFilters(sp: Record<string, string | string[] | undefined>): IncidentFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const estado = one("estado");
  const severidad = one("severidad");
  return {
    estado:
      estado === "todos" || (INCIDENT_STATUSES as readonly string[]).includes(estado ?? "")
        ? (estado as IncidentStatus | "todos")
        : "activos",
    severidad: (INCIDENT_SEVERITIES as readonly string[]).includes(severidad ?? "")
      ? (severidad as IncidentSeverity)
      : undefined,
    sector: one("sector")?.trim() || undefined,
  };
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = parseFilters(searchParams);
  const incidents = await listIncidents(filters);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <div>
          <h1 className="text-sm font-bold text-fg-primary">Centro de Incidentes</h1>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            Reporte, asignación y resolución de incidentes operativos.
          </p>
        </div>
        <Link href="/connect/incidentes/nuevo" className="btn btn-primary btn-sm">
          <Icon name="plus" size={14} /> Reportar incidente
        </Link>
      </header>

      {/* Filtros por GET (sin JS de cliente) */}
      <form method="get" className="flex flex-wrap items-end gap-2 border-b border-stroke-soft bg-bg-surface px-4 py-2">
        <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
          Estado
          <select name="estado" defaultValue={filters.estado ?? "activos"} className="input text-xs">
            <option value="activos">Activos (no cerrados)</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>{INCIDENT_STATUS_LABELS[s]}</option>
            ))}
            <option value="todos">Todos</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
          Severidad
          <select name="severidad" defaultValue={filters.severidad ?? ""} className="input text-xs">
            <option value="">Todas</option>
            {INCIDENT_SEVERITIES.map((s) => (
              <option key={s} value={s}>{INCIDENT_SEVERITY_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
          Sector
          <input name="sector" defaultValue={filters.sector ?? ""} placeholder="ej. D4" className="input w-24 text-xs" />
        </label>
        <button type="submit" className="btn btn-ghost btn-sm text-xs">
          <Icon name="filter" size={13} /> Filtrar
        </button>
      </form>

      <div className="flex-1 p-4">
        {incidents.length === 0 ? (
          <EmptyState
            icon="bolt"
            title="Sin incidentes"
            hint="No hay incidentes para los filtros elegidos."
          />
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stroke-soft text-[10px] uppercase tracking-wide text-fg-muted">
                  <th className="px-3 py-2 font-semibold">Incidente</th>
                  <th className="px-3 py-2 font-semibold">Severidad</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2 font-semibold">Sector</th>
                  <th className="px-3 py-2 font-semibold">Asignado</th>
                  <th className="px-3 py-2 font-semibold">Reportado</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((i) => (
                  <tr key={i.id} className="border-b border-stroke-soft last:border-0 hover:bg-bg-surface-alt">
                    <td className="px-3 py-2">
                      <Link href={`/connect/incidentes/${i.id}`} className="group flex min-w-0 flex-col">
                        <span className="font-mono text-[10px] text-fg-link">{i.publicId}</span>
                        <span className="truncate font-semibold text-fg-primary group-hover:underline">
                          {i.titulo}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2"><SeverityChip severidad={i.severidad} /></td>
                    <td className="px-3 py-2"><StatusChip estado={i.estado} /></td>
                    <td className="px-3 py-2 text-fg-muted">{i.sector ?? "—"}</td>
                    <td className="px-3 py-2 text-fg-muted">
                      {i.asignadoAName ?? (i.asignadoA ? "Asignado" : "Sin asignar")}
                    </td>
                    <td className="px-3 py-2 text-fg-muted" title={i.reportadoPorName ?? undefined}>
                      {timeAgo(i.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
