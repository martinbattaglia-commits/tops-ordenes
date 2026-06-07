import { Kpi, StatusPill } from "@/components/tesoreria/ui";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { PagoForm } from "@/components/tesoreria/PagoForm";
import { listSupplierOpenItems, getSupplierCurrentAccount, listBankAccounts } from "@/lib/tesoreria/data";

export const metadata = { title: "Pagos · Tesorería" };
export const dynamic = "force-dynamic";

export default async function PagosPage() {
  try {
    const [openItems, current, accounts] = await Promise.all([
      listSupplierOpenItems(),
      getSupplierCurrentAccount(),
      listBankAccounts(),
    ]);
    const pendiente = current.reduce((s, c) => s + Number(c.saldo_cuenta), 0); // D5 roll-up server-side

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Pagos</h1>
            <p className="page-subtitle">Cuenta corriente de proveedores (derivada) y registro de pagos.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Kpi label="Pagos pendientes" value={pendiente} />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="card p-5">
            <h2 className="font-semibold mb-3">Facturas abiertas (open items)</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="py-1">Factura</th>
                  <th className="py-1 text-right">Total</th>
                  <th className="py-1 text-right">Saldo</th>
                  <th className="py-1">Estado</th>
                  <th className="py-1">Vto</th>
                </tr>
              </thead>
              <tbody>
                {openItems.length === 0 && <tr><td colSpan={5} className="py-4 text-fg-muted">Sin facturas abiertas.</td></tr>}
                {openItems.map((it) => (
                  <tr key={it.invoice_id} className="border-t">
                    <td className="py-2 tabular">{it.public_id}</td>
                    <td className="py-2 text-right tabular">{fmtCurrency(it.total)}</td>
                    <td className="py-2 text-right tabular">{fmtCurrency(it.saldo)}</td>
                    <td className="py-2"><StatusPill status={it.estado_pago} /></td>
                    <td className="py-2">{fmtDate(it.fecha_vencimiento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PagoForm accounts={accounts} openItems={openItems} />
        </div>
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable title="Pagos no disponibles" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />
    );
  }
}
