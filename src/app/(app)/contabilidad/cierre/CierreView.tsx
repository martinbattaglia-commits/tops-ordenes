"use client";

import { useState, useTransition } from "react";
import { simularCierre } from "@/lib/contabilidad/actions";
import type { PeriodoCierreRow } from "@/lib/contabilidad/types";

export function CierreView({ periodos }: { periodos: PeriodoCierreRow[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  function simular(periodId: string) {
    startTransition(async () => {
      const res = await simularCierre(periodId);
      setResult((p) => ({ ...p, [periodId]: { ok: res.ok, text: res.message } }));
    });
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-fg-muted border-b border-border-subtle">
            <th className="p-3">Período</th>
            <th className="p-3">Estado</th>
            <th className="p-3 text-right">Descuadrados</th>
            <th className="p-3 text-right">Sin asiento</th>
            <th className="p-3 text-right">Diffs IVA</th>
            <th className="p-3">¿Listo?</th>
            <th className="p-3">Simulación</th>
          </tr>
        </thead>
        <tbody>
          {periodos.map((p) => (
            <tr key={p.periodId} className="border-b border-border-subtle/50 align-top">
              <td className="p-3 font-medium text-fg-brand">{p.year}-{String(p.month).padStart(2, "0")}</td>
              <td className="p-3">{p.status}</td>
              <td className={`p-3 text-right ${p.descuadrados ? "text-status-error" : ""}`}>{p.descuadrados}</td>
              <td className={`p-3 text-right ${p.comprobantesSinAsiento ? "text-status-warning" : ""}`}>{p.comprobantesSinAsiento}</td>
              <td className={`p-3 text-right ${p.ivaDiffs ? "text-status-warning" : ""}`}>{p.ivaDiffs}</td>
              <td className="p-3">
                <span className={p.listo ? "text-status-success" : "text-fg-muted"}>{p.listo ? "Listo" : "No"}</span>
              </td>
              <td className="p-3">
                <button
                  type="button"
                  disabled={pending || p.status !== "open"}
                  onClick={() => simular(p.periodId)}
                  className="text-xs px-2 py-1 rounded border border-border-subtle hover:bg-bg-subtle disabled:opacity-50"
                >
                  Simular cierre
                </button>
                {result[p.periodId] && (
                  <div className={`mt-1 text-xs ${result[p.periodId].ok ? "text-fg-secondary" : "text-status-error"}`}>
                    {result[p.periodId].text}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
