"use client";

import { useState, useTransition } from "react";
import { simularPricingOrden } from "@/lib/contabilidad/actions";
import type { OrdenPricingRow, BillableServiceRow } from "@/lib/contabilidad/types";

export function PricingView({
  orders, services,
}: {
  orders: OrdenPricingRow[];
  services: BillableServiceRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [svc, setSvc] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  function simular(orderId: string) {
    startTransition(async () => {
      const res = await simularPricingOrden(orderId, svc[orderId] || undefined);
      setResult((p) => ({ ...p, [orderId]: { ok: res.ok, text: res.message } }));
    });
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-fg-muted border-b border-border-subtle">
            <th className="p-3">Orden</th>
            <th className="p-3">Cliente (texto)</th>
            <th className="p-3 text-right">Match cliente</th>
            <th className="p-3">¿Priceable?</th>
            <th className="p-3">Motivo</th>
            <th className="p-3">Simular con servicio</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.orderId} className="border-b border-border-subtle/40 align-top">
              <td className="p-3 font-mono text-xs">{o.publicId}</td>
              <td className="p-3">{o.clientName}</td>
              <td className={`p-3 text-right ${o.clientMatches === 1 ? "" : "text-status-warning"}`}>{o.clientMatches}</td>
              <td className="p-3">
                <span className={o.priceable ? "text-status-success" : "text-fg-muted"}>{o.priceable ? "Sí" : "No"}</span>
              </td>
              <td className="p-3 text-xs text-fg-secondary">{o.motivoNoPriceable}</td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <select value={svc[o.orderId] ?? ""} onChange={(e) => setSvc((p) => ({ ...p, [o.orderId]: e.target.value }))} className="border border-border-subtle rounded px-2 py-1 text-xs">
                    <option value="">— servicio —</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                  </select>
                  <button type="button" disabled={pending} onClick={() => simular(o.orderId)} className="text-xs px-2 py-1 rounded border border-border-subtle hover:bg-bg-subtle disabled:opacity-50">
                    Simular
                  </button>
                </div>
                {result[o.orderId] && (
                  <div className={`mt-1 text-xs ${result[o.orderId].ok ? "text-fg-secondary" : "text-status-error"}`}>{result[o.orderId].text}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
