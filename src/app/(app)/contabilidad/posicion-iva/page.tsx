import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getPosicionIva } from "@/lib/contabilidad/data";

export const metadata = { title: "Posición de IVA" };
export const dynamic = "force-dynamic";

const RESULTADO_LABEL: Record<string, string> = {
  a_pagar: "A pagar",
  a_favor: "A favor",
  neutro: "Neutro",
};

export default async function PosicionIvaPage() {
  let rows;
  try {
    rows = await getPosicionIva();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Posición de IVA no disponible"
        migration="0086_accounting_reports"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Posición mensual de IVA</h1>
        <p className="text-sm text-fg-secondary">
          Débito fiscal (ventas) − crédito fiscal (compras) − percepciones IVA sufridas − retenciones
          sufridas = saldo a pagar / a favor. Fuente: libros IVA fiscales.
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
                <th className="p-3 text-right">IVA Débito</th>
                <th className="p-3 text-right">IVA Crédito</th>
                <th className="p-3 text-right">Saldo técnico</th>
                <th className="p-3 text-right">Percep. sufridas</th>
                <th className="p-3 text-right">Retenc. sufridas</th>
                <th className="p-3 text-right">Saldo posición</th>
                <th className="p-3">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.periodo} className="border-b border-border-subtle/50">
                  <td className="p-3 font-medium text-fg-brand">{r.periodo}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.ivaDebitoFiscal)}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.ivaCreditoFiscal)}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.saldoTecnico)}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.percepcionesIvaSufridas)}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.retencionesSufridas)}</td>
                  <td className="p-3 text-right font-semibold">{fmtCurrency(r.saldoPosicion)}</td>
                  <td className="p-3">
                    <span
                      className={
                        r.resultado === "a_pagar"
                          ? "text-status-error"
                          : r.resultado === "a_favor"
                          ? "text-status-success"
                          : "text-fg-muted"
                      }
                    >
                      {RESULTADO_LABEL[r.resultado] ?? r.resultado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-fg-muted">
        Nota: la posición es de naturaleza fiscal (no contable). Las retenciones practicadas a
        proveedores aún no se modelan (ver documentación contable, brechas pendientes).
      </p>
    </div>
  );
}
