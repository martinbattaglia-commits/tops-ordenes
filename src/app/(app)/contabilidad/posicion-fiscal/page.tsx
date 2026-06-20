import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getPosicionFiscalMensual } from "@/lib/contabilidad/data";

export const metadata = { title: "Posición fiscal mensual" };
export const dynamic = "force-dynamic";

export default async function PosicionFiscalPage() {
  let rows;
  try {
    rows = await getPosicionFiscalMensual();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Posición fiscal no disponible"
        migration="0089_phase10_posting_and_reports"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Posición fiscal mensual</h1>
        <p className="text-sm text-fg-secondary">
          Panorama del mes: saldo de IVA, percepciones y retenciones practicadas (a depositar) y
          percepciones/retenciones sufridas. Las percepciones/retenciones NO se mezclan con el saldo de IVA.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="card p-8 text-sm text-fg-secondary">Sin datos para mostrar.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Período</th>
                <th className="p-3 text-right">Saldo IVA</th>
                <th className="p-3">IVA</th>
                <th className="p-3 text-right">Percep. ventas a depositar</th>
                <th className="p-3 text-right">Retenc. practicadas a depositar</th>
                <th className="p-3 text-right">Percep. IVA sufridas</th>
                <th className="p-3 text-right">Retenc. sufridas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.periodo} className="border-b border-border-subtle/50">
                  <td className="p-3 font-medium text-fg-brand">{r.periodo}</td>
                  <td className="p-3 text-right font-semibold">{fmtCurrency(r.ivaSaldoPosicion)}</td>
                  <td className="p-3">
                    <span
                      className={
                        r.ivaResultado === "a_pagar"
                          ? "text-status-error"
                          : r.ivaResultado === "a_favor"
                          ? "text-status-success"
                          : "text-fg-muted"
                      }
                    >
                      {r.ivaResultado === "a_pagar" ? "A pagar" : r.ivaResultado === "a_favor" ? "A favor" : "Neutro"}
                    </span>
                  </td>
                  <td className="p-3 text-right">{fmtCurrency(r.percepcionesVentasADepositar)}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.retencionesPracticadasADepositar)}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.percepcionesIvaSufridas)}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.retencionesSufridas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
