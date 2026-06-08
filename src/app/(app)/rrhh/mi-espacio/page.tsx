import Link from "next/link";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { canAccess } from "@/lib/rbac/guard";
import { getMiLegajo } from "@/lib/rrhh/data";

export const metadata = { title: "Mi espacio · RRHH" };
export const dynamic = "force-dynamic";

export default async function MiEspacioPage() {
  if (!(await canAccess("mi_espacio.view"))) return <AccesoRestringido modulo="Mi Espacio" />;
  try {
    const legajo = await getMiLegajo();
    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">RRHH · Portal del empleado</div>
            <h1 className="page-title">Mi espacio</h1>
            <p className="page-subtitle">Tu legajo, tus solicitudes y tus documentos.</p>
          </div>
        </div>

        {!legajo ? (
          <div className="card p-5">
            <p className="text-fg-muted text-sm">
              Tu usuario no está vinculado a un legajo de empleado. Si creés que es un error,
              contactá a RRHH.
            </p>
          </div>
        ) : (
          <>
            <div className="card p-5 mb-4">
              <h2 className="font-semibold mb-3">Mi legajo #{legajo.public_id}</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div><div className="text-xs text-fg-muted">Apellido y nombre</div><div>{legajo.apellido_nombre}</div></div>
                <div><div className="text-xs text-fg-muted">Sección</div><div>{legajo.seccion ?? "—"}</div></div>
                <div><div className="text-xs text-fg-muted">Depósito</div><div>{legajo.depot ?? "—"}</div></div>
                <div><div className="text-xs text-fg-muted">Estado</div><div>{legajo.estado}</div></div>
                <div><div className="text-xs text-fg-muted">Ingreso</div><div>{legajo.fecha_ingreso ?? "—"}</div></div>
                <div><div className="text-xs text-fg-muted">Obra social</div><div>{legajo.obra_social ?? "—"}</div></div>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Link href="/rrhh/solicitudes" className="card p-4 hover:bg-bg-subtle">Mis solicitudes</Link>
              <Link href="/rrhh/documentos" className="card p-4 hover:bg-bg-subtle">Mis documentos</Link>
            </div>
          </>
        )}
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="RRHH · Mi espacio" migration="0058 (rrhh_core)" detail={String(e)} />;
  }
}
