import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getResultadoPorCC } from "@/lib/contabilidad/data";

export const metadata = { title: "Resultado por centro de costo" };
export const dynamic = "force-dynamic";

export default async function ResultadoCCPage() {
  let rows;
  try {
    rows = await getResultadoPorCC();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Resultado por centro de costo no disponible"
        migration="0094_cost_center_posting_reports"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Resultado por centro de costo</h1>
        <p className="text-sm text-fg-secondary">
          Rentabilidad por unidad de negocio / centro de costo y período. Las ventas se imputan por
          el centro de costo de la factura; las compras, por el de la factura de proveedor.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="card p-8 text-sm text-fg-secondary">
          Sin datos. Asigná centro de costo a facturas y contabilizá para ver resultados por CC.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Período</th>
                <th className="p-3">Centro de costo</th>
                <th className="p-3 text-right">Ingresos</th>
                <th className="p-3 text-right">Gastos</th>
                <th className="p-3 text-right">Resultado</th>
                <th className="p-3 text-right">Margen %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border-subtle/50">
                  <td className="p-3 font-medium text-fg-brand">{r.periodo}</td>
                  <td className="p-3">
                    <span className="font-mono text-xs text-fg-muted">{r.centroCostoCode}</span> {r.centroCostoNombre}
                  </td>
                  <td className="p-3 text-right">{fmtCurrency(r.ingresos)}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.gastos)}</td>
                  <td className={`p-3 text-right font-semibold ${r.resultado >= 0 ? "text-status-success" : "text-status-error"}`}>
                    {fmtCurrency(r.resultado)}
                  </td>
                  <td className="p-3 text-right">{r.margenPct == null ? "—" : `${r.margenPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
