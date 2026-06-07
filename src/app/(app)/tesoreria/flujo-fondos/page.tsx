import { Kpi } from "@/components/tesoreria/ui";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getCashflowProjection, getBankBalances } from "@/lib/tesoreria/data";

export const metadata = { title: "Flujo de fondos · Tesorería" };
export const dynamic = "force-dynamic";

export default async function FlujoFondosPage() {
  try {
    const [flow, banks] = await Promise.all([getCashflowProjection(), getBankBalances()]);
    const saldoActual = banks.reduce((s, b) => s + Number(b.balance), 0); // D1 roll-up server-side
    const saldoProyectado = saldoActual + (flow.length ? Number(flow[flow.length - 1].flujo_acumulado) : 0);

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Flujo de fondos</h1>
            <p className="page-subtitle">Proyección de cobros y pagos por vencimiento (derivada de las vistas).</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Kpi label="Saldo actual" value={saldoActual} />
          <Kpi label="Saldo proyectado" value={saldoProyectado} />
        </div>

        <div className="card p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-1">Fecha</th>
                <th className="py-1">Tipo</th>
                <th className="py-1 text-right">Monto</th>
                <th className="py-1 text-right">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {flow.length === 0 && <tr><td colSpan={4} className="py-4 text-fg-muted">Sin vencimientos proyectados.</td></tr>}
              {flow.map((r, i) => (
                <tr key={`${r.fecha}-${i}`} className="border-t">
                  <td className="py-2">{fmtDate(r.fecha)}</td>
                  <td className="py-2">{r.tipo}</td>
                  <td className="py-2 text-right tabular">{fmtCurrency(r.monto)}</td>
                  <td className="py-2 text-right tabular">{fmtCurrency(r.flujo_acumulado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable title="Flujo de fondos no disponible" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />
    );
  }
}
