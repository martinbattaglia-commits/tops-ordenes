import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { canAccess } from "@/lib/rbac/guard";
import { getDashboardCounts, hasPerm } from "@/lib/rrhh/data";

export const metadata = { title: "RRHH" };
export const dynamic = "force-dynamic";

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

export default async function RrhhDashboardPage() {
  if (!(await canAccess("rrhh.view"))) return <AccesoRestringido modulo="RRHH" />;
  try {
    const [k, canExport] = await Promise.all([getDashboardCounts(), hasPerm("rrhh.export")]);
    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Recursos Humanos</div>
            <h1 className="page-title">Dashboard RRHH</h1>
            <p className="page-subtitle">
              Indicadores de dotación, ausencias y solicitudes. Todos los números se leen de la
              base; no se calculan en el frontend.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <Kpi label="Dotación total" value={k.dotacion_total} />
          <Kpi label="Activos" value={k.activos} />
          <Kpi label="En licencia" value={k.en_licencia} />
          <Kpi label="Solicitudes pendientes" value={k.solicitudes_pendientes} />
          <Kpi label="Vacaciones pendientes" value={k.vacaciones_pendientes} />
          <Kpi label="Licencias activas" value={k.licencias_activas} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link href="/rrhh/empleados" className="card p-4 nx-interactive cursor-pointer flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700">
            <Icon name="clients" /> <span>Empleados</span>
          </Link>
          <Link href="/rrhh/solicitudes" className="card p-4 nx-interactive cursor-pointer flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700">
            <Icon name="calendar" /> <span>Solicitudes</span>
          </Link>
          <Link href="/rrhh/novedades" className="card p-4 nx-interactive cursor-pointer flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700">
            <Icon name="report" /> <span>Novedades</span>
          </Link>
          <Link href="/rrhh/documentos" className="card p-4 nx-interactive cursor-pointer flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700">
            <Icon name="lock" /> <span>Documentación</span>
          </Link>
          <Link href="/organigrama" className="card p-4 nx-interactive cursor-pointer flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700">
            <Icon name="building" /> <span>Organigrama</span>
          </Link>
          <Link href="/rrhh/mi-espacio" className="card p-4 nx-interactive cursor-pointer flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700">
            <Icon name="user" /> <span>Mi espacio</span>
          </Link>
        </div>

        {!canExport && (
          <p className="text-xs text-fg-muted mt-6">
            Vista acotada por permisos: algunos indicadores y reportes requieren rol de RRHH/Dirección.
          </p>
        )}
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="RRHH" migration="0056–0060 (rrhh)" detail={String(e)} />;
  }
}
