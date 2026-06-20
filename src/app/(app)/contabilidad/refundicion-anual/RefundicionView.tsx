"use client";

import { useState, useTransition } from "react";
import { fmtCurrency } from "@/lib/utils";
import { simularRefundicionAnual } from "@/lib/contabilidad/actions";
import type { ResultadoAnualRow } from "@/lib/contabilidad/types";

export function RefundicionView({ resultados }: { resultados: ResultadoAnualRow[] }) {
  const [pending, startTransition] = useTransition();
  const [year, setYear] = useState(new Date().getFullYear());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function simular() {
    setMsg(null);
    startTransition(async () => {
      const res = await simularRefundicionAnual(year);
      setMsg({ ok: res.ok, text: res.message });
    });
  }

  return (
    <div className="space-y-5">
      <section className="card p-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-fg-muted mb-1">Ejercicio</span>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="border border-border-subtle rounded px-3 py-2 w-32" />
        </label>
        <button type="button" disabled={pending} onClick={simular} className="btn-primary px-4 py-2 rounded disabled:opacity-50">
          {pending ? "Simulando…" : "Simular refundición anual"}
        </button>
        <span className="text-xs text-fg-muted">La simulación es read-only. La ejecución real requiere RPC + confirmación + contabilidad.admin.</span>
      </section>

      {msg && <div className={`card p-3 text-sm ${msg.ok ? "text-fg-secondary" : "text-status-error"}`}>{msg.text}</div>}

      <section className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">Resultado por ejercicio</div>
        {resultados.length === 0 ? (
          <div className="p-6 text-sm text-fg-secondary">Sin resultados contabilizados.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Ejercicio</th>
                <th className="p-3 text-right">Ingresos</th>
                <th className="p-3 text-right">Gastos</th>
                <th className="p-3 text-right">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((r) => (
                <tr key={r.ejercicio} className="border-b border-border-subtle/50">
                  <td className="p-3 font-medium text-fg-brand">{r.ejercicio}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.ingresos)}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.gastos)}</td>
                  <td className={`p-3 text-right font-semibold ${r.resultadoEjercicio >= 0 ? "text-status-success" : "text-status-error"}`}>
                    {fmtCurrency(r.resultadoEjercicio)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
