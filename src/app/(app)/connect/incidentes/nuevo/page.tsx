// Nexus Link · reportar incidente (F4.2). Gate connect.view heredado del layout;
// el alta re-valida connect.create (action + RPC).

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { NewIncidentForm } from "../../_components/NewIncidentForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Reportar incidente" };

export default function NewIncidentPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <Link href="/connect/incidentes" className="btn btn-ghost btn-sm" aria-label="Volver a incidentes">
          <Icon name="arrow-left" size={14} />
        </Link>
        <div>
          <h1 className="text-sm font-bold text-fg-primary">Reportar incidente</h1>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            Sector → avería → severidad. Las fotos y comentarios van al hilo del incidente.
          </p>
        </div>
      </header>
      <div className="p-4">
        <NewIncidentForm />
      </div>
    </div>
  );
}
