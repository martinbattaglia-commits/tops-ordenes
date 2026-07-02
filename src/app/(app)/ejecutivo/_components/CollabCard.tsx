// Cockpit · card COLABORACIÓN (F4.3, read-only): pulso de incidentes, tareas y
// workflows de Nexus Link, con navegación a los centros. Server component
// auto-contenida; si las fuentes no están disponibles, no se renderiza
// (filosofía honesta del cockpit — sin datos falsos).

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getCollabSummary } from "@/lib/connect/read/collab-summary";

export async function CollabCard() {
  const s = await getCollabSummary();
  if (!s) return null;

  const cells: Array<{ label: string; value: number; href: string; alert?: boolean }> = [
    { label: "Incidentes abiertos", value: s.incidentesAbiertos, href: "/connect/incidentes" },
    { label: "Críticos", value: s.incidentesCriticos, href: "/connect/incidentes?severidad=critica", alert: s.incidentesCriticos > 0 },
    { label: "Tareas abiertas", value: s.tareasAbiertas, href: "/connect/tareas" },
    { label: "Vencidas", value: s.tareasVencidas, href: "/connect/tareas", alert: s.tareasVencidas > 0 },
    { label: "Vacantes", value: s.tareasVacantes, href: "/connect/tareas?vista=vacantes" },
    { label: "Workflows en curso", value: s.workflowsEnCurso, href: "/connect/tareas" },
  ];

  return (
    <section className="nx-surface card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-2">
          <Icon name="chat" size={14} className="text-fg-link" />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted">
            Colaboración · Nexus Link
          </span>
        </div>
        <Link href="/connect" className="text-[11px] text-fg-link hover:underline">
          Abrir Nexus Link
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((c) => (
          <Link key={c.label} href={c.href}
            className="group rounded-lg bg-bg-surface-alt px-3 py-2 transition hover:bg-bg-surface">
            <p className={`text-xl font-bold ${c.alert ? "text-red-400" : "text-fg-primary"}`}>
              {c.value}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-fg-muted group-hover:text-fg-primary">
              {c.label}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
