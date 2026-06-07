import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listNovedades } from "@/lib/rrhh/data";

export const metadata = { title: "Novedades · RRHH" };
export const dynamic = "force-dynamic";

export default async function NovedadesPage({ searchParams }: { searchParams: { periodo?: string } }) {
  try {
    const novedades = await listNovedades(searchParams?.periodo);
    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">RRHH · Período</div>
            <h1 className="page-title">Novedades</h1>
            <p className="page-subtitle">Registro del período (núcleo para liquidación externa). Solo lectura; corrección por contrapartida.</p>
          </div>
        </div>
        <div className="card p-5">
          {novedades.length === 0 ? (
            <p className="text-fg-muted text-sm">No hay novedades visibles para tu rol.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted"><th className="py-1">Período</th><th>Tipo</th><th className="text-right">Cantidad</th><th>Confirmada</th></tr>
              </thead>
              <tbody>
                {novedades.map((n) => (
                  <tr key={n.id} className="border-t border-border">
                    <td className="py-2">{n.periodo}</td>
                    <td>{n.tipo}</td>
                    <td className="text-right">{n.cantidad}</td>
                    <td>{n.confirmada ? "sí" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="RRHH · Novedades" migration="0059 (rrhh_workflows)" detail={String(e)} />;
  }
}
