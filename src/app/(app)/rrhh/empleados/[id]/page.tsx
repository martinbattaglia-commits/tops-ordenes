import Link from "next/link";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getEmpleado, getEmpleadoBancario, getEmpleadoHistorial, hasPerm } from "@/lib/rrhh/data";

export const metadata = { title: "Legajo · RRHH" };
export const dynamic = "force-dynamic";

export default async function EmpleadoDetailPage({ params }: { params: { id: string } }) {
  try {
    const empleado = await getEmpleado(params.id);
    if (!empleado) {
      return (
        <div className="p-8">
          <p className="text-fg-muted">Empleado no encontrado o sin acceso.</p>
          <Link href="/rrhh/empleados" className="link">Volver</Link>
        </div>
      );
    }
    const [isAdmin, bancario, historial] = await Promise.all([
      hasPerm("rrhh.admin"),
      getEmpleadoBancario(empleado.id),
      getEmpleadoHistorial(empleado.id),
    ]);

    const Field = ({ k, v }: { k: string; v: string | number | null }) => (
      <div><div className="text-xs text-fg-muted">{k}</div><div>{v ?? "—"}</div></div>
    );

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">RRHH · Legajo #{empleado.public_id}</div>
            <h1 className="page-title">{empleado.apellido_nombre}</h1>
          </div>
          <Link href="/rrhh/empleados" className="btn btn-sm">Volver</Link>
        </div>

        <div className="card p-5 mb-4">
          <h2 className="font-semibold mb-3">Datos laborales</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Field k="CUIL" v={empleado.cuil} />
            <Field k="Categoría" v={empleado.categoria} />
            <Field k="Sección" v={empleado.seccion} />
            <Field k="Depósito" v={empleado.depot} />
            <Field k="Convenio" v={empleado.convenio} />
            <Field k="Ingreso" v={empleado.fecha_ingreso} />
            <Field k="Antigüedad desde" v={empleado.fecha_reconocida} />
            <Field k="Estado" v={empleado.estado} />
          </div>
        </div>

        {isAdmin && (
          <div className="card p-5 mb-4">
            <h2 className="font-semibold mb-3">Datos bancarios <span className="badge badge-warning">PII</span></h2>
            {bancario.length === 0 ? (
              <p className="text-fg-muted text-sm">Sin datos bancarios cargados.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-fg-muted"><th>Banco</th><th>CBU</th><th>Alias</th><th>Desde</th></tr></thead>
                <tbody>
                  {bancario.map((b) => (
                    <tr key={b.id} className="border-t border-border">
                      <td className="py-1">{b.banco}</td><td>{b.cbu ?? "—"}</td><td>{b.alias ?? "—"}</td><td>{b.vigente_desde ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="card p-5">
          <h2 className="font-semibold mb-3">Historial</h2>
          {historial.length === 0 ? (
            <p className="text-fg-muted text-sm">Sin cambios registrados.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {historial.map((h) => (
                <li key={h.id} className="border-t border-border py-1">
                  <span className="text-fg-muted">{h.vigente_desde}</span> · {h.campo}: {h.valor_anterior ?? "—"} → {h.valor_nuevo ?? "—"}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="RRHH · Legajo" migration="0058 (rrhh_core)" detail={String(e)} />;
  }
}
