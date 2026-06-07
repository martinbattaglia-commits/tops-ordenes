import Link from "next/link";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listEmpleados } from "@/lib/rrhh/data";

export const metadata = { title: "Empleados · RRHH" };
export const dynamic = "force-dynamic";

const ESTADO_BADGE: Record<string, string> = {
  activo: "badge badge-success",
  licencia: "badge badge-warning",
  baja: "badge",
};

export default async function EmpleadosPage() {
  try {
    const empleados = await listEmpleados();
    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">RRHH · Legajos</div>
            <h1 className="page-title">Empleados</h1>
            <p className="page-subtitle">Legajo digital. El acceso a datos sensibles está restringido por rol.</p>
          </div>
        </div>

        <div className="card p-5">
          {empleados.length === 0 ? (
            <p className="text-fg-muted text-sm">No hay empleados visibles para tu rol.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="py-1">Legajo</th>
                  <th className="py-1">Apellido y nombre</th>
                  <th className="py-1">Sección</th>
                  <th className="py-1">Depósito</th>
                  <th className="py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {empleados.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="py-2">{e.public_id}</td>
                    <td className="py-2">
                      <Link href={`/rrhh/empleados/${e.id}`} className="link">{e.apellido_nombre}</Link>
                    </td>
                    <td className="py-2">{e.seccion ?? "—"}</td>
                    <td className="py-2">{e.depot ?? "—"}</td>
                    <td className="py-2"><span className={ESTADO_BADGE[e.estado] ?? "badge"}>{e.estado}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="RRHH · Empleados" migration="0058 (rrhh_core)" detail={String(e)} />;
  }
}
