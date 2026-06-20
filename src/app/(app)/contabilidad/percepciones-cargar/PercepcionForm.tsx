"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtCurrency } from "@/lib/utils";
import { cargarPercepcionesVenta } from "@/lib/contabilidad/actions";
import { SALES_OTHER_TAX_LABEL, type CustomerInvoiceOption } from "@/lib/contabilidad/types";

const TYPES = ["PERCEPCION_IVA", "PERCEPCION_IIBB", "PERCEPCION_MUNICIPAL", "IMPUESTO_INTERNO", "OTRO"];

interface LineDraft {
  type: string;
  jurisdiction: string;
  base: string;
  rate: string;
  amount: string;
}
const num = (s: string): number => {
  const x = Number(s);
  return isFinite(x) ? x : 0;
};

export function PercepcionForm({ invoices }: { invoices: CustomerInvoiceOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);

  const selected = invoices.find((i) => i.id === invoiceId);
  const cabecera = (selected?.percepciones ?? 0) + (selected?.tributos ?? 0);
  const totalLines = useMemo(() => lines.reduce((a, l) => a + num(l.amount), 0), [lines]);
  const cuadra = !selected || Math.abs(totalLines - cabecera) <= 0.02;
  const valid = invoiceId && lines.some((l) => num(l.amount) > 0);

  function submit() {
    if (!valid) return;
    setMsg(null);
    startTransition(async () => {
      const res = await cargarPercepcionesVenta(
        invoiceId,
        lines
          .filter((l) => num(l.amount) > 0)
          .map((l) => ({
            taxType: l.type,
            jurisdiction: l.jurisdiction || undefined,
            taxBase: l.base ? num(l.base) : undefined,
            rate: l.rate ? num(l.rate) : undefined,
            amount: num(l.amount),
          }))
      );
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) {
        setLines([]);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`card p-3 text-sm ${msg.ok ? "text-status-success" : "text-status-error"}`}>{msg.text}</div>
      )}

      <section className="card p-4 space-y-3">
        <label className="text-sm block">
          <span className="block text-fg-muted mb-1">Factura de venta</span>
          <select value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setMsg(null); }} className="w-full border border-border-subtle rounded px-3 py-2">
            <option value="">— Elegí una factura —</option>
            {invoices.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </label>
        {selected && (
          <div className="text-xs text-fg-secondary">
            Cabecera (percepciones + tributos): <strong>{fmtCurrency(cabecera)}</strong> · Σ detalle:{" "}
            <strong className={cuadra ? "text-status-success" : "text-status-warning"}>{fmtCurrency(totalLines)}</strong>
            {!cuadra && " — para el desglose contable por tipo, el detalle debe coincidir con la cabecera (±0,02)."}
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-border-subtle flex items-center justify-between">
          <span className="font-semibold text-fg-brand">Percepciones / otros tributos</span>
          <button type="button" onClick={() => setLines((p) => [...p, { type: "PERCEPCION_IIBB", jurisdiction: "", base: "", rate: "", amount: "" }])} className="text-xs px-2 py-1 rounded border border-border-subtle hover:bg-bg-subtle">
            + Agregar línea
          </button>
        </div>
        {lines.length === 0 ? (
          <div className="p-6 text-sm text-fg-secondary">Agregá al menos una percepción/tributo.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="px-4 py-1.5">Tipo</th>
                <th className="px-4 py-1.5">Jurisdicción</th>
                <th className="px-4 py-1.5 text-right">Base</th>
                <th className="px-4 py-1.5 text-right">Alícuota %</th>
                <th className="px-4 py-1.5 text-right">Importe</th>
                <th className="px-4 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-border-subtle/40">
                  <td className="px-4 py-1.5">
                    <select value={l.type} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} className="border border-border-subtle rounded px-2 py-1">
                      {TYPES.map((t) => <option key={t} value={t}>{SALES_OTHER_TAX_LABEL[t] ?? t}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-1.5">
                    <input value={l.jurisdiction} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, jurisdiction: e.target.value } : x)))} className="w-28 border border-border-subtle rounded px-2 py-1" />
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" step="0.01" value={l.base} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, base: e.target.value } : x)))} className="w-28 border border-border-subtle rounded px-2 py-1 text-right" />
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" step="0.0001" value={l.rate} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} className="w-20 border border-border-subtle rounded px-2 py-1 text-right" />
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" step="0.01" value={l.amount} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className="w-28 border border-border-subtle rounded px-2 py-1 text-right" />
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-xs text-status-error">Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="flex justify-end">
        <button type="button" disabled={!valid || pending} onClick={submit} className="btn-primary px-5 py-2 rounded disabled:opacity-50">
          {pending ? "Guardando…" : "Cargar percepciones"}
        </button>
      </div>
    </div>
  );
}
