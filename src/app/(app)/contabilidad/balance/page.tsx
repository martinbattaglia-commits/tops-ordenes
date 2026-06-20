import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getBalanceSumasSaldos, getEstadoResultados } from "@/lib/contabilidad/data";
import { ACCOUNT_TYPE_LABEL } from "@/lib/contabilidad/types";

export const metadata = { title: "Balance de sumas y saldos" };
export const dynamic = "force-dynamic";

export default async function BalancePage() {
  let balance, resultados;
  try {
    [balance, resultados] = await Promise.all([
      getBalanceSumasSaldos(),
      getEstadoResultados(),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Balance no disponible"
        migration="0086_accounting_reports"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  // Mostrar solo cuentas con movimiento.
  const conMov = balance.filter((r) => r.totalDebe !== 0 || r.totalHaber !== 0);
  const sumDebe = balance.reduce((a, r) => a + r.totalDebe, 0);
  const sumHaber = balance.reduce((a, r) => a + r.totalHaber, 0);
  const sumDeudor = balance.reduce((a, r) => a + r.saldoDeudor, 0);
  const sumAcreedor = balance.reduce((a, r) => a + r.saldoAcreedor, 0);
  const cuadra = Math.round((sumDebe - sumHaber) * 100) === 0 && Math.round((sumDeudor - sumAcreedor) * 100) === 0;

  const ingresos = resultados.filter((r) => r.cuentaTipo === "ingreso").reduce((a, r) => a + r.neto, 0);
  const gastos = resultados.filter((r) => r.cuentaTipo === "gasto").reduce((a, r) => a + r.neto, 0); // negativo
  const resultadoNeto = ingresos + gastos;

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Balance de sumas y saldos</h1>
        <p className="text-sm text-fg-secondary">
          Sumas (debe/haber) y saldos por cuenta imputable, con asientos posteados.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs text-fg-muted">Σ Debe = Σ Haber</div>
          <div className={`text-lg font-bold ${cuadra ? "text-status-success" : "text-status-error"}`}>
            {cuadra ? "Cuadra" : "Descuadra"}
          </div>
          <div className="text-xs text-fg-secondary">
            {fmtCurrency(sumDebe)} / {fmtCurrency(sumHaber)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-fg-muted">Resultado del período (acumulado)</div>
          <div className={`text-lg font-bold ${resultadoNeto >= 0 ? "text-status-success" : "text-status-error"}`}>
            {fmtCurrency(resultadoNeto)}
          </div>
          <div className="text-xs text-fg-secondary">
            Ingresos {fmtCurrency(ingresos)} − Gastos {fmtCurrency(Math.abs(gastos))}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-fg-muted">Cuentas con movimiento</div>
          <div className="text-lg font-bold text-fg-brand">{conMov.length}</div>
        </div>
      </div>

      <section className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">
          Balance de comprobación
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-fg-muted border-b border-border-subtle">
              <th className="p-3">Código</th>
              <th className="p-3">Cuenta</th>
              <th className="p-3">Tipo</th>
              <th className="p-3 text-right">Debe</th>
              <th className="p-3 text-right">Haber</th>
              <th className="p-3 text-right">Saldo deudor</th>
              <th className="p-3 text-right">Saldo acreedor</th>
            </tr>
          </thead>
          <tbody>
            {conMov.map((r) => (
              <tr key={r.accountId} className="border-b border-border-subtle/40">
                <td className="p-3 font-mono text-xs text-fg-muted">{r.cuentaCodigo}</td>
                <td className="p-3">{r.cuentaNombre}</td>
                <td className="p-3 text-fg-muted">{ACCOUNT_TYPE_LABEL[r.cuentaTipo]}</td>
                <td className="p-3 text-right">{fmtCurrency(r.totalDebe)}</td>
                <td className="p-3 text-right">{fmtCurrency(r.totalHaber)}</td>
                <td className="p-3 text-right">{r.saldoDeudor ? fmtCurrency(r.saldoDeudor) : ""}</td>
                <td className="p-3 text-right">{r.saldoAcreedor ? fmtCurrency(r.saldoAcreedor) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border-subtle font-bold text-fg-brand">
              <td className="p-3" colSpan={3}>Totales</td>
              <td className="p-3 text-right">{fmtCurrency(sumDebe)}</td>
              <td className="p-3 text-right">{fmtCurrency(sumHaber)}</td>
              <td className="p-3 text-right">{fmtCurrency(sumDeudor)}</td>
              <td className="p-3 text-right">{fmtCurrency(sumAcreedor)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}
