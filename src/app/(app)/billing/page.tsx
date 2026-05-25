import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listOrders } from "@/lib/data/orders";
import { fmtCurrency, fmtDate } from "@/lib/utils";

export const metadata = { title: "Facturación" };

export default async function BillingPage() {
  const { rows } = await listOrders({ pageSize: 1000 });
  const facturables = rows.filter((o) => o.status === "FIRMADA");
  const total = facturables.reduce((a, b) => a + b.total, 0);
  const byClient = new Map<string, { total: number; count: number; razon: string; cuit: string }>();
  facturables.forEach((o) => {
    const k = o.client?.id ?? "—";
    const cur = byClient.get(k) ?? {
      total: 0,
      count: 0,
      razon: o.client?.razon ?? "—",
      cuit: o.client?.cuit ?? "",
    };
    cur.total += o.total;
    cur.count += 1;
    byClient.set(k, cur);
  });

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Por facturar · Mes en curso</div>
          <h1 className="page-title">Facturación</h1>
          <p className="page-subtitle">
            Órdenes firmadas listas para emitir factura A. Agrupadas por cliente para facilitar el
            cierre mensual.
          </p>
        </div>
        <div className="text-right">
          <div className="text-eyebrow-sm uppercase text-fg-muted">Total a facturar (neto)</div>
          <div className="text-3xl font-bold text-fg-brand tabular -tracking-[0.01em]">
            {fmtCurrency(total)}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="tbl">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>CUIT</th>
              <th className="text-right">Órdenes</th>
              <th className="text-right">Subtotal</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(byClient.entries()).map(([id, v]) => (
              <tr key={id}>
                <td className="font-semibold">{v.razon}</td>
                <td className="font-mono text-xs">{v.cuit}</td>
                <td className="text-right tabular">{v.count}</td>
                <td className="text-right tabular font-bold text-fg-brand">{fmtCurrency(v.total)}</td>
                <td className="text-right">
                  <Link
                    href={`/orders?search=${encodeURIComponent(v.razon)}&status=FIRMADA`}
                    className="btn btn-ghost btn-sm"
                  >
                    <Icon name="eye" size={12} /> Ver
                  </Link>
                </td>
              </tr>
            ))}
            {byClient.size === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-fg-muted py-8 text-sm">
                  No hay órdenes firmadas para facturar este mes.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-neutral-50">
              <td colSpan={3} className="font-bold text-right">
                TOTAL
              </td>
              <td className="text-right font-bold text-fg-brand tabular text-base">
                {fmtCurrency(total)}
              </td>
              <td className="text-right text-xs text-fg-muted">+ IVA 21 %</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-fg-muted mt-4">
        Generado el {fmtDate(new Date())}. Integración con AFIP Web Services pendiente —
        actualmente exportá CSV y procesá en el sistema contable.
      </p>
    </div>
  );
}
