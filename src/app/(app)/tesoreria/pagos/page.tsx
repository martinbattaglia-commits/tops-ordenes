import Link from "next/link";
import { Kpi, StatusPill } from "@/components/tesoreria/ui";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { PagoForm } from "@/components/tesoreria/PagoForm";
import { listSupplierOpenItems, listPagosDetail, getSupplierCurrentAccount, listBankAccounts } from "@/lib/tesoreria/data";

export const metadata = { title: "Pagos · Tesorería" };
export const dynamic = "force-dynamic";

export default async function PagosPage() {
  try {
    const [openItems, detail, current, accounts] = await Promise.all([
      listSupplierOpenItems(),
      listPagosDetail(),
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

        {/* Detalle de pagos pendientes — drill-down del KPI. Orden: vencimiento asc. */}
        <div className="card p-5 mb-6 overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Detalle de pagos pendientes</h2>
            <span className="text-sm text-fg-muted">Total: <strong className="text-fg-brand tabular">{fmtCurrency(pendiente)}</strong></span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-1">Proveedor</th>
                <th className="py-1">Factura</th>
                <th className="py-1">Emisión</th>
                <th className="py-1">Vencimiento</th>
                <th className="py-1">Estado</th>
                <th className="py-1 text-right">Saldo pendiente</th>
              </tr>
            </thead>
            <tbody>
              {detail.length === 0 && <tr><td colSpan={6} className="py-4 text-fg-muted">No hay pagos pendientes.</td></tr>}
              {detail.map((it) => (
                <tr key={it.invoiceId} className="border-t">
                  <td className="py-2">
                    {it.proveedor ? (
                      <Link href={it.vendorId ? `/compras/proveedores/${it.vendorId}` : "/compras/proveedores"} className="text-fg-link hover:underline cursor-pointer font-semibold">{it.proveedor}</Link>
                    ) : <span className="text-fg-muted">—</span>}
                  </td>
                  <td className="py-2 tabular">{it.factura}</td>
                  <td className="py-2">{fmtDate(it.emision)}</td>
                  <td className="py-2">{fmtDate(it.vencimiento)}</td>
                  <td className="py-2"><StatusPill status={it.estado} dueDate={it.vencimiento} /></td>
                  <td className="py-2 text-right tabular">{fmtCurrency(it.saldo)}</td>
                </tr>
              ))}
            </tbody>
            {detail.length > 0 && (
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="py-2" colSpan={5}>Total pendiente</td>
                  <td className="py-2 text-right tabular text-fg-brand">{fmtCurrency(pendiente)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Registro de pago */}
        <PagoForm accounts={accounts} openItems={openItems} />
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable title="Pagos no disponibles" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />
    );
  }
}
