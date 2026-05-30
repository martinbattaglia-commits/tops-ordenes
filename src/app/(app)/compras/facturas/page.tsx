import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listSupplierInvoices } from "@/lib/erp/data";
import {
  SUPPLIER_INVOICE_STATUS_META,
  SUPPLIER_COMPROBANTE_LABEL,
} from "@/lib/erp/types";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";

export const metadata = { title: "Facturas de proveedores" };
export const dynamic = "force-dynamic";

function nroComprobante(pv: number, nro: string): string {
  return `${String(pv).padStart(5, "0")}-${nro.padStart(8, "0")}`;
}

export default async function SupplierInvoicesPage() {
  // supplier_invoices / cost_centers (migración 0014) pueden no estar
  // aplicados todavía en prod. Degradar con gracia en vez de romper el shell.
  let result: Awaited<ReturnType<typeof listSupplierInvoices>>;
  try {
    result = await listSupplierInvoices({ pageSize: 100 });
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Facturas de proveedores no disponibles"
        migration="0014_supplier_invoices"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const { rows, counts, sumTotal, sumPendiente } = result;
  const pagadas = counts["pagada"] ?? 0;

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Cuentas por pagar · ERP</div>
          <h1 className="page-title">Facturas de proveedores</h1>
          <p className="page-subtitle">
            Registro de comprobantes de proveedores, conciliación contra OC e
            imputación a centros de costo. Base del módulo de cuentas por pagar.
          </p>
        </div>
        <div className="flex items-start gap-6">
          <div className="text-right">
            <div className="text-eyebrow-sm uppercase text-fg-muted">Saldo a pagar</div>
            <div className="text-3xl font-bold text-fg-brand tabular -tracking-[0.01em]">
              {fmtCurrency(sumPendiente)}
            </div>
          </div>
          <Link href="/compras/facturas/nueva" className="btn btn-primary btn-sm mt-1">
            <Icon name="plus" size={14} stroke={2.2} />
            <span>Nueva factura</span>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Comprobantes" value={String(counts["todas"] ?? 0)} sub="total cargados" />
        <Stat label="Pendientes de pago" value={String((counts["pendiente"] ?? 0) + (counts["conciliada"] ?? 0) + (counts["aprobada"] ?? 0))} sub="incluye aprobadas" />
        <Stat label="Pagadas" value={String(pagadas)} sub="ciclo cerrado" />
        <Stat label="Monto total" value={fmtCurrency(sumTotal)} sub="todos los estados" />
      </div>

      {/* Tabla */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft">
          <h2 className="text-sm font-semibold">Comprobantes registrados</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>N° interno</th>
                <th>Comprobante</th>
                <th>Proveedor</th>
                <th>Centro de costo</th>
                <th>Emisión</th>
                <th>Vencimiento</th>
                <th>Estado</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => {
                const meta = SUPPLIER_INVOICE_STATUS_META[inv.status];
                return (
                  <tr key={inv.id}>
                    <td className="font-mono text-xs font-semibold">{inv.public_id}</td>
                    <td className="text-xs">
                      <div>{SUPPLIER_COMPROBANTE_LABEL[inv.tipo_comprobante]}</div>
                      <div className="font-mono text-[10px] text-fg-muted">
                        {nroComprobante(inv.punto_venta, inv.numero)}
                      </div>
                    </td>
                    <td>
                      <div className="text-sm font-semibold text-fg-primary">{inv.vendor?.razon ?? "—"}</div>
                      <div className="font-mono text-[10px] text-fg-muted">{inv.vendor?.cuit ?? ""}</div>
                    </td>
                    <td className="text-xs text-fg-secondary">
                      {inv.cost_center ? `${inv.cost_center.code} · ${inv.cost_center.name}` : "—"}
                    </td>
                    <td className="text-xs">{fmtDate(inv.fecha_emision)}</td>
                    <td className="text-xs">{inv.fecha_vencimiento ? fmtDate(inv.fecha_vencimiento) : "—"}</td>
                    <td>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: `${meta.color}15`, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="text-right tabular font-bold text-fg-brand">
                      {fmtCurrency(inv.total)}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-fg-muted py-8 text-sm">
                    Aún no se registraron facturas de proveedores.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-fg-muted mt-4">
        Las facturas se imputan a{" "}
        <Link href="/settings/centros-costo" className="underline">
          centros de costo
        </Link>{" "}
        y se concilian contra las órdenes de compra emitidas. Próximo paso del ERP:
        tesorería (pagos y cuentas corrientes).
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-5">
      <div className="kpi-label">{label}</div>
      <div className="text-2xl font-bold tabular leading-none mt-1 text-fg-brand">{value}</div>
      <div className="text-[11px] text-fg-muted mt-1">{sub}</div>
    </div>
  );
}
