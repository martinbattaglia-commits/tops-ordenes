import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Kpi } from "@/components/tesoreria/ui";
import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import {
  getBankBalances,
  getCustomerCurrentAccount,
  getSupplierCurrentAccount,
  getCashflowProjection,
} from "@/lib/tesoreria/data";

export const metadata = { title: "Tesorería" };
export const dynamic = "force-dynamic";

export default async function TesoreriaOverviewPage() {
  try {
    const [banks, cc, sc, flow] = await Promise.all([
      getBankBalances(),
      getCustomerCurrentAccount(),
      getSupplierCurrentAccount(),
      getCashflowProjection(),
    ]);
    // D1/D5: roll-up SERVER-SIDE sobre filas de vistas (nunca en React cliente).
    const saldoBancos = banks.reduce((s, b) => s + Number(b.balance), 0);
    const cobrPend = cc.reduce((s, c) => s + Number(c.saldo_cuenta), 0);
    const pagoPend = sc.reduce((s, c) => s + Number(c.saldo_cuenta), 0);
    const flujoProy = flow.length ? Number(flow[flow.length - 1].flujo_acumulado) : 0;

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Tesorería</h1>
            <p className="page-subtitle">
              Saldos bancarios, cobranzas y pagos. Todos los saldos se derivan en la base
              (vistas), nunca se calculan en el frontend.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Kpi label="Saldo en bancos" value={saldoBancos} />
          <Link href="/tesoreria/cobranzas" className="nx-interactive block rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700" title="Ver detalle de cobranzas pendientes">
            <Kpi label="Cobranzas pendientes" value={cobrPend} />
          </Link>
          <Link href="/tesoreria/pagos" className="nx-interactive block rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700" title="Ver detalle de pagos pendientes">
            <Kpi label="Pagos pendientes" value={pagoPend} />
          </Link>
          <Kpi label="Flujo proyectado" value={flujoProy} />
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Bancos</h2>
            <Link href="/tesoreria/bancos" className="btn btn-sm">Ver todos</Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-1">Cuenta</th>
                <th className="py-1 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {banks.map((b) => (
                <tr key={b.bank_account_id} className="border-t">
                  <td className="py-2">{b.bank_name} · {b.account_name}{b.is_system ? " (CAJA)" : ""}</td>
                  <td className="py-2 text-right tabular">{fmtCurrency(b.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-3 mt-6">
          <Link href="/tesoreria/pagos" className="btn btn-primary btn-sm"><Icon name="cart" size={14} /> Registrar pago a proveedor</Link>
          <Link href="/tesoreria/operativo" className="btn btn-primary btn-sm"><Icon name="plus" size={14} /> Registrar movimiento operativo</Link>
          <Link href="/tesoreria/movimientos" className="btn btn-sm">Historial de movimientos</Link>
          <Link href="/tesoreria/cobranzas" className="btn btn-sm"><Icon name="download" size={14} /> Cobranzas</Link>
          <Link href="/tesoreria/flujo-fondos" className="btn btn-sm"><Icon name="trend-up" size={14} /> Flujo de fondos</Link>
        </div>
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Tesorería no disponible"
        migration="0053_treasury_core"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }
}
