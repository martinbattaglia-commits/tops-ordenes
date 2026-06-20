"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtCurrency } from "@/lib/utils";
import {
  crearBillingRun, calcularRecurrente, setBillingItemStatus, generarBorradorFactura,
} from "@/lib/contabilidad/actions";
import type { BillingRunRow, BillingRunItemRow } from "@/lib/contabilidad/types";

export function BillingView({
  runs, items, selectedRunId, canWrite,
}: {
  runs: BillingRunRow[];
  items: BillingRunItemRow[];
  selectedRunId: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const today = new Date();
  const [start, setStart] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`);
  const [end, setEnd] = useState(new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10));

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.message });
      router.refresh();
    });
  }

  const approvedCustomers = Array.from(
    new Map(items.filter((i) => i.status === "approved").map((i) => [i.customerId, i.cliente])).entries()
  );

  return (
    <div className="space-y-5">
      {msg && <div className={`card p-3 text-sm ${msg.ok ? "text-status-success" : "text-status-error"}`}>{msg.text}</div>}
      {!canWrite && <div className="card p-3 text-sm text-fg-muted">Solo lectura: operar requiere <code className="font-mono">contabilidad.edit</code>.</div>}

      {canWrite && (
        <section className="card p-4 flex flex-wrap items-end gap-3">
          <label className="text-sm"><span className="block text-fg-muted mb-1">Desde</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="border border-border-subtle rounded px-3 py-2" /></label>
          <label className="text-sm"><span className="block text-fg-muted mb-1">Hasta</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="border border-border-subtle rounded px-3 py-2" /></label>
          <button type="button" disabled={pending} onClick={() => run(() => crearBillingRun(start, end))} className="btn-primary px-4 py-2 rounded disabled:opacity-50">
            Crear billing run
          </button>
        </section>
      )}

      <section className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">Billing runs ({runs.length})</div>
        {runs.length === 0 ? (
          <div className="p-6 text-sm text-fg-secondary">Sin billing runs.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Período</th><th className="p-3">Tipo</th><th className="p-3">Estado</th>
                <th className="p-3 text-right">Ítems</th><th className="p-3 text-right">Total bruto</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.billingRunId} className={`border-b border-border-subtle/40 ${selectedRunId === r.billingRunId ? "bg-bg-subtle" : ""}`}>
                  <td className="p-3">{r.periodStart} → {r.periodEnd}</td>
                  <td className="p-3 text-fg-muted">{r.runType}</td>
                  <td className="p-3">{r.status}</td>
                  <td className="p-3 text-right">{r.items}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.totalBruto)}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button type="button" onClick={() => router.push(`/contabilidad/billing?run=${r.billingRunId}`)} className="text-xs px-2 py-1 rounded border border-border-subtle hover:bg-bg-subtle">Ver ítems</button>
                    {canWrite && (
                      <button type="button" disabled={pending} onClick={() => run(() => calcularRecurrente(r.billingRunId))} className="ml-2 text-xs px-2 py-1 rounded border border-border-subtle hover:bg-bg-subtle disabled:opacity-50">Calcular recurrente</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedRunId && (
        <section className="card overflow-x-auto">
          <div className="px-4 py-2 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-fg-brand">Ítems del run ({items.length})</span>
            {canWrite && approvedCustomers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {approvedCustomers.map(([cid, name]) => (
                  <button key={cid} type="button" disabled={pending}
                    onClick={() => run(() => generarBorradorFactura(selectedRunId, cid))}
                    className="text-xs px-2 py-1 rounded bg-bg-brand text-white disabled:opacity-50">
                    Borrador factura: {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {items.length === 0 ? (
            <div className="p-6 text-sm text-fg-secondary">Sin ítems. Usá “Calcular recurrente”.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted border-b border-border-subtle">
                  <th className="p-3">Cliente</th><th className="p-3">Servicio</th>
                  <th className="p-3 text-right">Cant.</th><th className="p-3 text-right">Neto</th>
                  <th className="p-3 text-right">IVA</th><th className="p-3 text-right">Bruto</th>
                  <th className="p-3">Estado</th>{canWrite && <th className="p-3"></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.itemId} className="border-b border-border-subtle/40">
                    <td className="p-3">{i.cliente}</td>
                    <td className="p-3"><span className="font-mono text-xs text-fg-muted">{i.servicioCode}</span> {i.servicio}</td>
                    <td className="p-3 text-right">{i.quantity}</td>
                    <td className="p-3 text-right">{fmtCurrency(i.netAmount)}</td>
                    <td className="p-3 text-right">{fmtCurrency(i.vatAmount)}</td>
                    <td className="p-3 text-right">{fmtCurrency(i.grossAmount)}</td>
                    <td className="p-3">{i.status}</td>
                    {canWrite && (
                      <td className="p-3 text-right whitespace-nowrap">
                        {i.status !== "invoiced" && (
                          <>
                            <button type="button" disabled={pending} onClick={() => run(() => setBillingItemStatus(i.itemId, "approved"))} className="text-xs text-status-success">Aprobar</button>
                            <button type="button" disabled={pending} onClick={() => run(() => setBillingItemStatus(i.itemId, "excluded"))} className="ml-2 text-xs text-status-error">Excluir</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
