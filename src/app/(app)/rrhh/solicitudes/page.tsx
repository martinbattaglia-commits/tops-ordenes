import Link from "next/link";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listSolicitudes } from "@/lib/rrhh/data";

export const metadata = { title: "Solicitudes · RRHH" };
export const dynamic = "force-dynamic";

const ESTADO_BADGE: Record<string, string> = {
  borrador: "badge",
  pendiente_supervisor: "badge badge-warning",
  pendiente_rrhh: "badge badge-warning",
  aprobada: "badge badge-success",
  rechazada: "badge badge-danger",
  cancelada: "badge",
  anulada: "badge badge-danger",
};

export default async function SolicitudesPage() {
  try {
    const solicitudes = await listSolicitudes();
    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">RRHH · Workflow</div>
            <h1 className="page-title">Solicitudes</h1>
            <p className="page-subtitle">Vacaciones, permisos, licencias y horas extra. Aprobación supervisor → RRHH.</p>
          </div>
        </div>
        <div className="card p-5">
          {solicitudes.length === 0 ? (
            <p className="text-fg-muted text-sm">No hay solicitudes visibles para tu rol.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="py-1">N°</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {solicitudes.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-2"><Link href={`/rrhh/solicitudes/${s.id}`} className="link">{s.public_id}</Link></td>
                    <td>{s.tipo}{s.subtipo ? ` · ${s.subtipo}` : ""}</td>
                    <td>{s.fecha_desde}</td>
                    <td>{s.fecha_hasta}</td>
                    <td><span className={ESTADO_BADGE[s.estado] ?? "badge"}>{s.estado}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="RRHH · Solicitudes" migration="0059 (rrhh_workflows)" detail={String(e)} />;
  }
}
