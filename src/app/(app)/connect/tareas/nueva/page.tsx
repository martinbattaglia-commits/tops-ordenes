// Nexus Link · nueva tarea (F4.3). Acepta ?incidente=<uuid> para pre-vincular
// (botón "Crear tarea" del detalle de incidente). Gate connect.view heredado;
// el alta re-valida connect.create (action + RPC).

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getIncident } from "@/lib/connect/read/incidents-data";
import { NewTaskForm } from "../../_components/NewTaskForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Nueva tarea" };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const incidentParam = typeof searchParams.incidente === "string" ? searchParams.incidente : null;
  const incident = incidentParam ? await getIncident(incidentParam) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <Link href="/connect/tareas" className="btn btn-ghost btn-sm" aria-label="Volver a tareas">
          <Icon name="arrow-left" size={14} />
        </Link>
        <div>
          <h1 className="text-sm font-bold text-fg-primary">Nueva tarea</h1>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            Sin responsable queda vacante y cualquiera del equipo puede reclamarla.
          </p>
        </div>
      </header>
      <div className="p-4">
        <NewTaskForm
          incidentId={incident?.id ?? null}
          incidentLabel={incident ? `${incident.publicId} — ${incident.titulo}` : null}
        />
      </div>
    </div>
  );
}
