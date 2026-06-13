import { Fragment } from "react";
import Link from "next/link";
import { Kpi, StatusPill } from "@/components/tesoreria/ui";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { PagoForm } from "@/components/tesoreria/PagoForm";
import { listSupplierOpenItems, listPagosDetail, getSupplierCurrentAccount, listBankAccounts } from "@/lib/tesoreria/data";
import type { PagoDetailRow } from "@/lib/tesoreria/data";

export const metadata = { title: "Pagos · Tesorería" };
export const dynamic = "force-dynamic";

function groupByVendor(rows: PagoDetailRow[]) {
  const map = new Map<string, { proveedor: string | null; vendorId: string | null; items: PagoDetailRow[] }>();
  for (const row of rows) {
    const key = row.vendorId ?? `__nv__${row.proveedor ?? ""}`;
    if (!map.has(key)) map.set(key, { proveedor: row.proveedor, vendorId: row.vendorId, items: [] });
    map.get(key)!.items.push(row);
  }
  return Array.from(map.values());
}

export default async function PagosPage() {
  try {
    const [openItems, detail, current, accounts] = await Promise.all([
      listSupplierOpenItems(),
      listPagosDetail(),
      getSupplierCurrentAccount(),
      listBankAccounts(),
    ]);
    const pendiente = current.reduce((s, c) => s + Number(c.saldo_cuenta), 0); // D5 roll-up server-side
    const grupos = groupByVendor(detail);

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

        {/* Detalle agrupado por proveedor */}
        <div className="card p-5 mb-6 overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Detalle de pagos pendientes</h2>
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
                <tr><td colSpan={5} className="py-4 text-fg-muted">No hay pagos pendientes.</td></tr>
              )}
              {grupos.map((grupo) => {
                const subtotal = grupo.items.reduce((s, it) => s + (it.saldo > 0 ? it.saldo : 0), 0);
                const groupKey = grupo.vendorId ?? `nv-${grupo.proveedor ?? "unknown"}`;
                return (
                  <Fragment key={groupKey}>
                    {/* Encabezado de grupo — proveedor */}
                    <tr className="border-t-2 border-border bg-white/[0.03]">
                      <td colSpan={5} className="py-2 px-1">
                        {grupo.vendorId ? (
                          <Link href={`/compras/proveedores/${grupo.vendorId}`} className="font-semibold text-fg-link hover:underline">
                            {grupo.proveedor ?? "—"}
                          </Link>
                        ) : (
                          <span className="font-semibold text-fg-primary">{grupo.proveedor ?? "Sin proveedor"}</span>
                        )}
                      </td>
                    </tr>
                    {/* Comprobantes del proveedor */}
                    {grupo.items.map((it) => (
                      <tr key={it.invoiceId} className="border-t border-border/60">
                        <td className="py-2 pl-4 tabular">{it.factura}</td>
                        <td className="py-2">{fmtDate(it.emision)}</td>
                        <td className="py-2">{fmtDate(it.vencimiento)}</td>
                        <td className="py-2"><StatusPill status={it.estado} dueDate={it.vencimiento} /></td>
                        <td className="py-2 text-right tabular">{fmtCurrency(it.saldo)}</td>
                      </tr>
                    ))}
                    {/* Subtotal por proveedor */}
                    <tr className="border-t border-border/60 bg-white/[0.03]">
                      <td colSpan={4} className="py-1.5 pl-4 text-xs text-fg-muted italic">
                        Subtotal · {grupo.proveedor ?? "sin proveedor"}
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
