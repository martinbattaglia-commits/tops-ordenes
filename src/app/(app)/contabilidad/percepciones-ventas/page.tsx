import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getPercepcionesVentas } from "@/lib/contabilidad/data";
import { SALES_OTHER_TAX_LABEL } from "@/lib/contabilidad/types";

export const metadata = { title: "Percepciones de venta" };
export const dynamic = "force-dynamic";

export default async function PercepcionesVentasPage() {
  let rows;
  try {
    rows = await getPercepcionesVentas();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Percepciones de venta no disponibles"
        migration="0087_sales_other_taxes"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const total = rows.reduce((a, r) => a + r.importe, 0);

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Percepciones de venta</h1>
        <p className="text-sm text-fg-secondary">
          Percepciones y otros tributos practicados en ventas, por período, tipo y jurisdicción
          (notas de crédito restan). Total: {fmtCurrency(total)}.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="card p-8 text-sm text-fg-secondary">
          No hay percepciones de venta registradas. Se cargan vía la RPC{" "}
          <code className="font-mono">ventas_persist_other_taxes</code>.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Período</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Jurisdicción</th>
                <th className="p-3 text-right">Comprobantes</th>
                <th className="p-3 text-right">Base imponible</th>
                <th className="p-3 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border-subtle/50">
                  <td className="p-3 font-medium text-fg-brand">{r.periodo}</td>
                  <td className="p-3">{SALES_OTHER_TAX_LABEL[r.taxType] ?? r.taxType}</td>
                  <td className="p-3 text-fg-muted">{r.jurisdiction || "—"}</td>
                  <td className="p-3 text-right">{r.comprobantes}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.baseImponible)}</td>
                  <td className="p-3 text-right font-medium">{fmtCurrency(r.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
