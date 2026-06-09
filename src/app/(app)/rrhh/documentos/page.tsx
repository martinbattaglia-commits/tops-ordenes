import { redirect } from "next/navigation";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { canAccess } from "@/lib/rbac/guard";
import { listDocumentos } from "@/lib/rrhh/data";
import { DOC_CLASS_LABEL } from "@/lib/rrhh/types";
import { getDocumentoSignedUrl } from "@/lib/rrhh/actions";

export const metadata = { title: "Documentación · RRHH" };
export const dynamic = "force-dynamic";

export default async function DocumentosPage() {
  // Gate granular (RBAC-PERMISSION 2026-06-08): Documentación requiere su propio
  // permiso (separado de rrhh.view) para poder bloquearla a gerencia_comercial /
  // administracion_finanzas manteniendo el resto de RRHH visible.
  if (!(await canAccess("rrhh.documentacion.view"))) return <AccesoRestringido modulo="RRHH · Documentación" />;
  try {
    const docs = await listDocumentos();

    // Descarga: autoriza+audita en la base (RPC) y redirige al signed URL efímero.
    async function descargar(fd: FormData) {
      "use server";
      const r = await getDocumentoSignedUrl({ document_id: String(fd.get("id") ?? ""), reason: "descarga UI" });
      if (r.ok && r.url) redirect(r.url);
    }

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">RRHH · Documentación</div>
            <h1 className="page-title">Documentos</h1>
            <p className="page-subtitle">Acceso por enlace firmado y auditado. La salud está restringida a RRHH y al dueño.</p>
          </div>
        </div>
        <div className="card p-5">
          {docs.length === 0 ? (
            <p className="text-fg-muted text-sm">No hay documentos cargados.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted"><th className="py-1">Tipo</th><th>Título</th><th>Bucket</th><th>Vence</th><th></th></tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="py-2">{DOC_CLASS_LABEL[d.doc_class]}</td>
                    <td>{d.titulo ?? "—"}</td>
                    <td>{d.storage_bucket}{d.storage_bucket === "rrhh-health" ? " 🔒" : ""}</td>
                    <td>{d.expires_at ?? "—"}</td>
                    <td className="text-right">
                      <form action={descargar}>
                        <input type="hidden" name="id" value={d.id} />
                        <button className="btn btn-sm" type="submit">Descargar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="RRHH · Documentación" migration="0060 (rrhh_documents_storage)" detail={String(e)} />;
  }
}
