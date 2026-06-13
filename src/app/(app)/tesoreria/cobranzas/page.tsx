import { Fragment } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/tesoreria/ui";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { CobranzaForm } from "@/components/tesoreria/CobranzaForm";
import { listCustomerOpenItems, listCobranzasDetail, getCustomerCurrentAccount, listBankAccounts } from "@/lib/tesoreria/data";
import type { CobranzaDetailRow } from "@/lib/tesoreria/data";

export const metadata = { title: "Cobranzas · Tesorería" };
export const dynamic = "force-dynamic";

function groupByClient(rows: CobranzaDetailRow[]) {
  const map = new Map<string, { cliente: string | null; clientId: string | null; items: CobranzaDetailRow[] }>();
  for (const row of rows) {
    const key = row.clientId ?? `__nc__${row.cliente ?? ""}`;
    if (!map.has(key)) map.set(key, { cliente: row.cliente, clientId: row.clientId, items: [] });
    map.get(key)!.items.push(row);
  }
  return Array.from(map.values());
}

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
    const grupos = groupByClient(detail);

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Cobranzas</h1>
            <p className="page-subtitle">Cuenta corriente de clientes (derivada) y registro de cobros.</p>
          </div>
        </div>

        {/* KPI maestro — TOTAL A COBRAR */}
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

        {/* Detalle agrupado por cliente */}
        <div className="card p-5 mb-6 overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Detalle de cobranzas pendientes</h2>
            <span className="text-sm text-fg-muted">Total: <strong className="text-fg-brand tabular">{fmtCurrency(pendiente)}</strong></span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-1">Factura</th>
                <th className="py-1">Emisión</th>
                <th className="py-1">Vencimiento</th>
                <th className="py-1">Estado</th>
                <th className="py-1 text-right">Saldo pendiente</th>
              </tr>
            </thead>
            <tbody>
              {detail.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-fg-muted">No hay cobranzas pendientes.</td></tr>
              )}
              {grupos.map((grupo) => {
                const subtotal = grupo.items.reduce((s, it) => s + (it.saldo > 0 ? it.saldo : 0), 0);
                const groupKey = grupo.clientId ?? `nc-${grupo.cliente ?? "unknown"}`;
                return (
                  <Fragment key={groupKey}>
                    {/* Encabezado de grupo — cliente */}
                    <tr className="border-t-2 border-border bg-white/[0.03]">
                      <td colSpan={5} className="py-2 px-1">
                        {grupo.clientId ? (
                          <Link href={`/clientes/${grupo.clientId}`} className="font-semibold text-fg-link hover:underline">
                            {grupo.cliente ?? "—"}
                          </Link>
                        ) : (
                          <span className="font-semibold text-fg-primary">{grupo.cliente ?? "Sin cliente"}</span>
                        )}
                      </td>
                    </tr>
                    {/* Comprobantes del cliente */}
                    {grupo.items.map((it) => (
                      <tr key={it.invoiceId} className="border-t border-border/60">
                        <td className="py-2 pl-4 tabular">#{it.factura}</td>
                        <td className="py-2">{fmtDate(it.emision)}</td>
                        <td className="py-2">{fmtDate(it.vencimiento)}</td>
                        <td className="py-2"><StatusPill status={it.estado} dueDate={it.vencimiento} /></td>
                        <td className="py-2 text-right tabular">{fmtCurrency(it.saldo)}</td>
                      </tr>
                    ))}
                    {/* Subtotal por cliente */}
                    <tr className="border-t border-border/60 bg-white/[0.03]">
                      <td colSpan={4} className="py-1.5 pl-4 text-xs text-fg-muted italic">
                        Subtotal · {grupo.cliente ?? "sin cliente"}
                      </td>
                      <td className="py-1.5 text-right tabular font-semibold text-fg-brand">
                        {fmtCurrency(subtotal)}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
            {detail.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-2" colSpan={4}>Total pendiente</td>
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
