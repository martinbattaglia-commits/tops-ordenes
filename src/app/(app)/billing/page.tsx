import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listOrders } from "@/lib/data/orders";
import { listInvoices } from "@/lib/invoicing/data";
import { INVOICE_STATUS_META, COMPROBANTE_LABEL } from "@/lib/invoicing/types";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { EmitInvoiceButton } from "./EmitInvoiceButton";

export const metadata = { title: "Facturación" };

function nroComprobante(pv: number, nro: number | null): string {
  return `${String(pv).padStart(5, "0")}-${String(nro ?? 0).padStart(8, "0")}`;
}

export default async function BillingPage() {
  // El esquema de facturación (customer_invoices, migración 0011_arca_billing)
  // puede no estar aplicado todavía en prod. Si falta, degradamos a un card
  // claro en lugar de tirar y romper todo el shell (root error.tsx).
  let rows: Awaited<ReturnType<typeof listOrders>>["rows"];
  let invoicesResult: Awaited<ReturnType<typeof listInvoices>>;
  try {
    const [ordersRes, invRes] = await Promise.all([
      listOrders({ pageSize: 1000 }),
      listInvoices({ pageSize: 50 }),
    ]);
    rows = ordersRes.rows;
    invoicesResult = invRes;
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Facturación no disponible"
        migration="0011_arca_billing"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const facturables = rows.filter((o) => o.status === "FIRMADA");
  const total = facturables.reduce((a, b) => a + b.total, 0);
  const byClient = new Map<
    string,
    { total: number; count: number; razon: string; cuit: string }
  >();
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

  const invoices = invoicesResult.rows;

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Comprobantes electrónicos · ARCA</div>
          <h1 className="page-title">Facturación</h1>
          <p className="page-subtitle">
            Órdenes firmadas listas para emitir Factura A electrónica con CAE y QR
            fiscal. Emisión vía ARCA (WSFEv1).
          </p>
        </div>
        <div className="flex items-start gap-6">
          <div className="text-right">
            <div className="text-eyebrow-sm uppercase text-fg-muted">A facturar (neto)</div>
            <div className="text-3xl font-bold text-fg-brand tabular -tracking-[0.01em]">
              {fmtCurrency(total)}
            </div>
          </div>
          <Link href="/settings/fiscal" className="btn btn-ghost btn-sm mt-1">
            <Icon name="gear" size={12} /> Config. fiscal
          </Link>
        </div>
      </div>

      {/* Pendientes de facturar, agrupados por cliente */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold">Pendientes de facturar</h2>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>CUIT</th>
              <th className="text-right">Órdenes</th>
              <th className="text-right">Subtotal</th>
              <th className="text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(byClient.entries()).map(([id, v]) => (
              <tr key={id}>
                <td className="font-semibold">{v.razon}</td>
                <td className="font-mono text-xs">{v.cuit}</td>
                <td className="text-right tabular">{v.count}</td>
                <td className="text-right tabular font-bold text-fg-brand">
                  {fmtCurrency(v.total)}
                </td>
                <td className="text-right">
                  {id !== "—" ? (
                    <EmitInvoiceButton clientId={id} razon={v.razon} />
                  ) : (
                    <span className="text-xs text-fg-muted">Sin cliente</span>
                  )}
                </td>
              </tr>
            ))}
            {byClient.size === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-fg-muted py-8 text-sm">
                  No hay órdenes firmadas para facturar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Comprobantes emitidos */}
      <div className="card overflow-hidden mt-6">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold">Comprobantes emitidos</h2>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Comprobante</th>
              <th>N°</th>
              <th>Cliente</th>
              <th>Fecha</th>
              <th>CAE</th>
              <th>Estado</th>
              <th className="text-right">Total</th>
              <th className="text-right">PDF</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const meta = INVOICE_STATUS_META[inv.estado_arca];
              return (
                <tr key={inv.id}>
                  <td className="text-xs">{COMPROBANTE_LABEL[inv.tipo_comprobante]}</td>
                  <td className="font-mono text-xs">
                    {nroComprobante(inv.punto_venta, inv.numero_comprobante)}
                  </td>
                  <td className="font-semibold text-xs">{inv.razon_social}</td>
                  <td className="text-xs">{fmtDate(inv.created_at)}</td>
                  <td className="font-mono text-xs">{inv.cae ?? "—"}</td>
                  <td>
                    <span className={`badge ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td className="text-right tabular font-bold text-fg-brand">
                    {fmtCurrency(inv.total)}
                  </td>
                  <td className="text-right">
                    {inv.estado_arca === "AUTORIZADO_ARCA" ? (
                      <a
                        href={`/api/invoices/${inv.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-sm"
                      >
                        <Icon name="file-pdf" size={12} /> Ver
                      </a>
                    ) : (
                      <span className="text-xs text-fg-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-fg-muted py-8 text-sm">
                  Aún no se emitieron comprobantes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-fg-muted mt-4">
        Generado el {fmtDate(new Date())}. La emisión usa el ambiente configurado en{" "}
        <Link href="/settings/fiscal" className="underline">
          Configuración fiscal
        </Link>
        . En SANDBOX los comprobantes se autorizan con un Mock ARCA Service (sin
        validez fiscal) hasta cargar las credenciales de producción.
      </p>
    </div>
  );
}
