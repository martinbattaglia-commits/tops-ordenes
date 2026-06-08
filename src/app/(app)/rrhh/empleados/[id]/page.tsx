import Link from "next/link";
import { redirect } from "next/navigation";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { canAccess } from "@/lib/rbac/guard";
import { getDocumentoSignedUrl } from "@/lib/rrhh/actions";
import { getEmpleado, getEmpleadoBancario, getEmpleadoHistorial, getEmpleadoDocumentos, hasPerm } from "@/lib/rrhh/data";
import { DOC_CLASS_LABEL, MODALIDAD_LABEL } from "@/lib/rrhh/types";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Legajo · RRHH" };
export const dynamic = "force-dynamic";

export default async function EmpleadoDetailPage({ params }: { params: { id: string } }) {
  if (!(await canAccess("rrhh.view"))) return <AccesoRestringido modulo="RRHH · Legajo" />;
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
    const [isAdmin, bancario, historial, documentos] = await Promise.all([
      hasPerm("rrhh.admin"),
      getEmpleadoBancario(empleado.id),
      getEmpleadoHistorial(empleado.id),
      getEmpleadoDocumentos(empleado.id),
    ]);
    const recibos = documentos.filter((d) => d.doc_class === "recibo_sueldo");
    const otrosDocs = documentos.filter((d) => d.doc_class !== "recibo_sueldo");

    const Field = ({ k, v }: { k: string; v: string | number | null }) => (
      <div><div className="text-xs text-fg-muted">{k}</div><div>{v ?? "—"}</div></div>
    );

    // Descarga: autoriza+audita en la base (RPC) y redirige al signed URL efímero.
    async function descargar(fd: FormData) {
      "use server";
      const r = await getDocumentoSignedUrl({ document_id: String(fd.get("id") ?? ""), reason: "descarga legajo" });
      if (r.ok && r.url) redirect(r.url);
    }

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
            <Field k="Modalidad" v={empleado.modalidad_contratacion ? (MODALIDAD_LABEL[empleado.modalidad_contratacion] ?? empleado.modalidad_contratacion) : "—"} />
            <div>
              <div className="text-xs text-fg-muted">Estado</div>
              <div className="flex items-center gap-2">
                {empleado.estado}
                {empleado.es_jubilado && <span className="badge badge-warning">Jubilado</span>}
              </div>
            </div>
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

        {/* CH5-b · Recibos de sueldo y documentación del legajo (URL firmada + auditada) */}
        <div className="card p-5 mb-4">
          <h2 className="font-semibold mb-3">Recibos de sueldo</h2>
          {recibos.length === 0 ? (
            <p className="text-fg-muted text-sm">Sin recibos asociados. Se vinculan al aplicar la ingesta CH5-b (Recibos → 2026 → Mayo).</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-fg-muted"><th className="py-1">Recibo</th><th>Período</th><th>Cargado</th><th></th></tr></thead>
              <tbody>
                {recibos.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="py-2">{d.titulo ?? DOC_CLASS_LABEL[d.doc_class]}</td>
                    <td>{d.expires_at ? "—" : "Mayo 2026"}</td>
                    <td>{fmtDate(d.created_at)}</td>
                    <td className="text-right">
                      <form action={descargar}><input type="hidden" name="id" value={d.id} /><button className="btn btn-sm" type="submit">Descargar</button></form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card p-5 mb-4">
          <h2 className="font-semibold mb-3">Documentación</h2>
          {otrosDocs.length === 0 ? (
            <p className="text-fg-muted text-sm">Sin otra documentación cargada.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-fg-muted"><th className="py-1">Tipo</th><th>Título</th><th>Vence</th><th></th></tr></thead>
              <tbody>
                {otrosDocs.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="py-2">{DOC_CLASS_LABEL[d.doc_class]}</td>
                    <td>{d.titulo ?? "—"}</td>
                    <td>{d.expires_at ?? "—"}</td>
                    <td className="text-right">
                      <form action={descargar}><input type="hidden" name="id" value={d.id} /><button className="btn btn-sm" type="submit">Descargar</button></form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

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
