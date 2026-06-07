import Link from "next/link";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listSolicitudes, getSolicitudEventos, hasPerm } from "@/lib/rrhh/data";
import { enviarSolicitud, aprobarL1, aprobarL2, rechazarSolicitud, cancelarSolicitud, anularSolicitud } from "@/lib/rrhh/actions";

export const metadata = { title: "Solicitud · RRHH" };
export const dynamic = "force-dynamic";

export default async function SolicitudDetailPage({ params }: { params: { id: string } }) {
  try {
    const all = await listSolicitudes();
    const s = all.find((x) => x.id === params.id) ?? null;
    if (!s) {
      return (
        <div className="p-8">
          <p className="text-fg-muted">Solicitud no encontrada o sin acceso.</p>
          <Link href="/rrhh/solicitudes" className="link">Volver</Link>
        </div>
      );
    }
    const [eventos, canRrhh] = await Promise.all([getSolicitudEventos(s.id), hasPerm("rrhh.edit")]);

    // Server actions ligadas a forms (RPC-First; la base valida fail-closed).
    async function aEnviar() { "use server"; await enviarSolicitud(params.id); }
    async function aL1() { "use server"; await aprobarL1(params.id); }
    async function aL2() { "use server"; await aprobarL2(params.id); }
    async function aRechazar() { "use server"; await rechazarSolicitud(params.id); }
    async function aCancelar() { "use server"; await cancelarSolicitud(params.id); }
    async function aAnular(fd: FormData) { "use server"; await anularSolicitud(params.id, String(fd.get("motivo") ?? "")); }

    const Btn = ({ children, action }: { children: React.ReactNode; action: () => Promise<void> }) => (
      <form action={action}><button className="btn btn-sm" type="submit">{children}</button></form>
    );

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">RRHH · Solicitud {s.public_id}</div>
            <h1 className="page-title">{s.tipo}{s.subtipo ? ` · ${s.subtipo}` : ""}</h1>
            <p className="page-subtitle">Estado: <span className="badge">{s.estado}</span> · {s.fecha_desde} → {s.fecha_hasta}</p>
          </div>
          <Link href="/rrhh/solicitudes" className="btn btn-sm">Volver</Link>
        </div>

        {s.motivo && <div className="card p-4 mb-4"><div className="text-xs text-fg-muted">Motivo</div><div>{s.motivo}</div></div>}

        <div className="card p-5 mb-4">
          <h2 className="font-semibold mb-3">Acciones</h2>
          <div className="flex flex-wrap gap-2 items-start">
            {s.estado === "borrador" && <Btn action={aEnviar}>Enviar</Btn>}
            {(s.estado === "borrador" || s.estado === "pendiente_supervisor" || s.estado === "pendiente_rrhh") && (
              <Btn action={aCancelar}>Cancelar</Btn>
            )}
            {s.estado === "pendiente_supervisor" && (<><Btn action={aL1}>Aprobar (supervisor)</Btn><Btn action={aRechazar}>Rechazar</Btn></>)}
            {s.estado === "pendiente_rrhh" && canRrhh && (<><Btn action={aL2}>Aprobar (RRHH)</Btn><Btn action={aRechazar}>Rechazar</Btn></>)}
            {s.estado === "aprobada" && canRrhh && (
              <form action={aAnular} className="flex gap-2 items-center">
                <input name="motivo" placeholder="Motivo de anulación" className="input input-sm" required />
                <button className="btn btn-sm btn-danger" type="submit">Anular</button>
              </form>
            )}
          </div>
          <p className="text-xs text-fg-muted mt-3">Las transiciones se validan en la base (permiso, jerarquía y estado). La UI solo ofrece las acciones aplicables.</p>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold mb-3">Trazabilidad</h2>
          {eventos.length === 0 ? (
            <p className="text-fg-muted text-sm">Sin eventos.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {eventos.map((ev) => (
                <li key={ev.id} className="border-t border-border py-1">
                  <span className="text-fg-muted">{ev.ts?.slice(0, 16).replace("T", " ")}</span> · {ev.accion}
                  {ev.nivel ? ` (${ev.nivel})` : ""}{ev.comentario ? ` — ${ev.comentario}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="RRHH · Solicitud" migration="0059 (rrhh_workflows)" detail={String(e)} />;
  }
}
