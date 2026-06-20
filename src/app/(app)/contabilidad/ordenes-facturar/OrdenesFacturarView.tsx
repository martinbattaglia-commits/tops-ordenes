"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtCurrency } from "@/lib/utils";
import { marcarOrdenBilling, vincularFacturaOrdenes } from "@/lib/contabilidad/actions";
import type { OrdenFacturableRow, OrdenFacturadaRow, CustomerInvoiceOption } from "@/lib/contabilidad/types";

export function OrdenesFacturarView({
  facturables,
  facturadas,
  invoices,
  canWrite,
}: {
  facturables: OrdenFacturableRow[];
  facturadas: OrdenFacturadaRow[];
  invoices: CustomerInvoiceOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [invoiceId, setInvoiceId] = useState("");

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) {
        setSelected({});
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      {msg && <div className={`card p-3 text-sm ${msg.ok ? "text-status-success" : "text-status-error"}`}>{msg.text}</div>}
      {!canWrite && (
        <div className="card p-3 text-sm text-fg-muted">
          Solo lectura: operar requiere el permiso <code className="font-mono">pedidos.edit</code>.
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">
          Pendientes de facturar ({facturables.length})
        </div>
        {facturables.length === 0 ? (
          <div className="p-6 text-sm text-status-success">✓ No hay órdenes pendientes de facturar.</div>
        ) : (
          <>
            {canWrite && (
              <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-b border-border-subtle bg-bg-subtle">
                <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className="border border-border-subtle rounded px-2 py-1 text-sm min-w-[260px]">
                  <option value="">— Factura de venta a vincular —</option>
                  {invoices.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
                <button
                  type="button"
                  disabled={pending || !invoiceId || selectedIds.length === 0}
                  onClick={() => run(() => vincularFacturaOrdenes(selectedIds, invoiceId))}
                  className="text-xs px-3 py-1.5 rounded bg-bg-brand text-white disabled:opacity-50"
                >
                  Vincular {selectedIds.length || ""} a factura
                </button>
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted border-b border-border-subtle">
                  {canWrite && <th className="px-4 py-1.5"></th>}
                  <th className="px-4 py-1.5">Orden</th>
                  <th className="px-4 py-1.5">Cliente</th>
                  <th className="px-4 py-1.5">Estado</th>
                  <th className="px-4 py-1.5">Fecha</th>
                  <th className="px-4 py-1.5 text-right">Monto facturable</th>
                  {canWrite && <th className="px-4 py-1.5"></th>}
                </tr>
              </thead>
              <tbody>
                {facturables.map((o) => (
                  <tr key={o.orderId} className="border-b border-border-subtle/40">
                    {canWrite && (
                      <td className="px-4 py-1.5">
                        <input type="checkbox" checked={!!selected[o.orderId]} onChange={(e) => setSelected((p) => ({ ...p, [o.orderId]: e.target.checked }))} />
                      </td>
                    )}
                    <td className="px-4 py-1.5 font-mono text-xs">{o.publicId}</td>
                    <td className="px-4 py-1.5">{o.clientName}</td>
                    <td className="px-4 py-1.5">{o.status}</td>
                    <td className="px-4 py-1.5">{o.fecha}</td>
                    <td className="px-4 py-1.5 text-right">{o.billableAmount != null ? fmtCurrency(o.billableAmount) : "—"}</td>
                    {canWrite && (
                      <td className="px-4 py-1.5 text-right">
                        <button type="button" disabled={pending} onClick={() => run(() => marcarOrdenBilling(o.orderId, "not_billable"))} className="text-xs text-status-error">
                          No facturable
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">
          Facturadas ({facturadas.length})
        </div>
        {facturadas.length === 0 ? (
          <div className="p-6 text-sm text-fg-secondary">Sin órdenes facturadas.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="px-4 py-1.5">Orden</th>
                <th className="px-4 py-1.5">Cliente</th>
                <th className="px-4 py-1.5">Factura</th>
                <th className="px-4 py-1.5 text-right">Total factura</th>
              </tr>
            </thead>
            <tbody>
              {facturadas.map((o) => (
                <tr key={o.orderId} className="border-b border-border-subtle/40">
                  <td className="px-4 py-1.5 font-mono text-xs">{o.publicId}</td>
                  <td className="px-4 py-1.5">{o.clientName}</td>
                  <td className="px-4 py-1.5 font-mono text-xs">{o.customerInvoiceId ?? "—"}</td>
                  <td className="px-4 py-1.5 text-right">{o.facturaTotal != null ? fmtCurrency(o.facturaTotal) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
