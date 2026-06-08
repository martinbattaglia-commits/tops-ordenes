import Link from "next/link";
import { StatusPill } from "@/components/tesoreria/ui";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { CobranzaForm } from "@/components/tesoreria/CobranzaForm";
import { listCustomerOpenItems, listCobranzasDetail, getCustomerCurrentAccount, listBankAccounts } from "@/lib/tesoreria/data";

export const metadata = { title: "Cobranzas · Tesorería" };
export const dynamic = "force-dynamic";

export default async function CobranzasPage() {
  try {
    const [openItems, detail, current, accounts] = await Promise.all([
      listCustomerOpenItems(),
      listCobranzasDetail(),
      getCustomerCurrentAccount(),
      listBankAccounts(),
    ]);
    const pendiente = current.reduce((s, c) => s + Number(c.saldo_cuenta), 0); // D5 roll-up server-side
    const clientesConDeuda = current.filter((c) => Number(c.saldo_cuenta) > 0).length;
    const facturasPend = detail.length;

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Cobranzas</h1>
            <p className="page-subtitle">Cuenta corriente de clientes (derivada) y registro de cobros.</p>
          </div>
        </div>

        {/* KPI maestro — TOTAL A COBRAR (verde corporativo, máxima jerarquía). Misma fuente: saldo_cuenta. */}
        <div className="card p-6 mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-l-4 border-status-success">
          <div className="sm:text-right sm:order-2 sm:ml-auto">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Total a cobrar</div>
            <div className="text-4xl md:text-5xl font-black tabular text-status-success leading-none mt-1">{fmtCurrency(pendiente)}</div>
            <div className="text-xs text-fg-secondary mt-2">
              {clientesConDeuda} {clientesConDeuda === 1 ? "cliente con deuda" : "clientes con deuda"} · {facturasPend} {facturasPend === 1 ? "factura pendiente" : "facturas pendientes"}
            </div>
          </div>
          <div className="sm:order-1 self-start sm:self-end">
            <p className="text-sm text-fg-secondary max-w-xs">Saldo total pendiente de cobro a clientes. El detalle por factura figura debajo.</p>
          </div>
        </div>

        {/* Detalle de cobranzas pendientes — drill-down del KPI. Orden: vencimiento asc. */}
        <div className="card p-5 mb-6 overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Detalle de cobranzas pendientes</h2>
            <span className="text-sm text-fg-muted">Total: <strong className="text-fg-brand tabular">{fmtCurrency(pendiente)}</strong></span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-1">Cliente</th>
                <th className="py-1">Factura</th>
                <th className="py-1">Emisión</th>
                <th className="py-1">Vencimiento</th>
                <th className="py-1">Estado</th>
                <th className="py-1 text-right">Saldo pendiente</th>
              </tr>
            </thead>
            <tbody>
              {detail.length === 0 && <tr><td colSpan={6} className="py-4 text-fg-muted">No hay cobranzas pendientes.</td></tr>}
              {detail.map((it) => (
                <tr key={it.invoiceId} className="border-t">
                  <td className="py-2">
                    {it.cliente ? (
                      <Link href={it.clientId ? `/clientes/${it.clientId}` : "/clients"} className="text-fg-link hover:underline cursor-pointer font-semibold">{it.cliente}</Link>
                    ) : <span className="text-fg-muted">—</span>}
                  </td>
                  <td className="py-2 tabular">#{it.factura}</td>
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

        {/* Registro de cobro */}
        <CobranzaForm accounts={accounts} openItems={openItems} />
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable title="Cobranzas no disponibles" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />
    );
  }
}
