import Link from "next/link";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getCentrosCosto } from "@/lib/contabilidad/data";

export const metadata = { title: "Centros de costo" };
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  unidad_negocio: "Unidad de negocio",
  sede: "Sede",
  deposito: "Depósito",
  servicio: "Servicio",
  cliente_estrategico: "Cliente estratégico",
  proyecto: "Proyecto",
  centro_operativo: "Centro operativo",
  centro_administrativo: "Centro administrativo",
};

export default async function CentrosCostoPage() {
  let rows;
  try {
    rows = await getCentrosCosto();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Centros de costo no disponibles"
        migration="0092_cost_centers_dimension"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg-brand">Centros de costo / unidades de negocio</h1>
          <p className="text-sm text-fg-secondary">
            {rows.length} centros. Dimensión transversal de ventas, compras, tesorería y contabilidad.
          </p>
        </div>
        <Link href="/settings/centros-costo" className="text-sm text-fg-brand underline">
          Crear / editar →
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="card p-8 text-sm text-fg-secondary">Sin centros de costo cargados.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Código</th>
                <th className="p-3">Nombre</th>
                <th className="p-3">Tipo</th>
                <th className="p-3 text-center">Activo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-subtle/50">
                  <td className="p-3 font-mono text-xs text-fg-secondary">{r.code}</td>
                  <td className="p-3">{r.name}</td>
                  <td className="p-3 text-fg-muted">{r.type ? (TYPE_LABEL[r.type] ?? r.type) : "—"}</td>
                  <td className="p-3 text-center">{r.active ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
