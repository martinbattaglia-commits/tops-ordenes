import { listAnnouncements } from "@/lib/comunicados/data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { RestrictedAccess } from "@/components/shell/RestrictedAccess";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { canAccess } from "@/lib/rbac/guard";
import { isCurrentUserAdmin } from "@/lib/auth/roles";
import { ComunicadosManager } from "./ComunicadosManager";

export const metadata = { title: "Comunicados" };
export const dynamic = "force-dynamic";

export default async function ComunicadosPage() {
  if (!(await canAccess("sistema.view"))) return <AccesoRestringido modulo="Sistema · Comunicados" />;
  if (!(await isCurrentUserAdmin())) {
    return <RestrictedAccess message="Solo Presidencia/Administración pueden gestionar los comunicados del cockpit." />;
  }

  let rows: Awaited<ReturnType<typeof listAnnouncements>>;
  try {
    rows = await listAnnouncements({ includeInactive: true });
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Comunicados no disponibles"
        migration="0084_announcements"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-4xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Cockpit · Command Center</div>
          <h1 className="page-title">Comunicados</h1>
          <p className="page-subtitle">
            Lo que se muestra en el banner del Cockpit Ejecutivo. El de prioridad “crítica” es el destacado amarillo;
            el resto aparecen como celdas. Desactivá uno para ocultarlo sin borrarlo.
          </p>
        </div>
      </div>
      <ComunicadosManager rows={rows} />
    </div>
  );
}
