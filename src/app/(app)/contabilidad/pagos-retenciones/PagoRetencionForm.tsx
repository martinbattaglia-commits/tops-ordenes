"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtCurrency } from "@/lib/utils";
import { registrarPagoConRetenciones } from "@/lib/contabilidad/actions";
import {
  WITHHOLDING_LABEL,
  type VendorOption,
  type BankOption,
  type SupplierOpenItemOption,
} from "@/lib/contabilidad/types";

const WH_TYPES = ["RETENCION_GANANCIAS", "RETENCION_IVA", "RETENCION_IIBB", "RETENCION_SUSS", "OTRA"];
const METHODS = ["transferencia", "cheque", "echeq"];

interface AllocDraft {
  invoiceId: string;
  publicId: string;
  saldo: number;
  gross: string; // input
}
interface WhDraft {
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

export function PagoRetencionForm({
  vendors,
  banks,
  openItems,
  canWrite,
}: {
  vendors: VendorOption[];
  banks: BankOption[];
  openItems: SupplierOpenItemOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [vendorId, setVendorId] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("transferencia");
  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const [operationNumber, setOperationNumber] = useState("");
  const [allocs, setAllocs] = useState<AllocDraft[]>([]);
  const [whs, setWhs] = useState<WhDraft[]>([]);

  function onVendorChange(id: string) {
    setVendorId(id);
    setAllocs(
      openItems
        .filter((oi) => oi.vendorId === id)
        .map((oi) => ({ invoiceId: oi.invoiceId, publicId: oi.publicId, saldo: oi.saldo, gross: "" }))
    );
    setMsg(null);
  }

  const grossTotal = useMemo(() => allocs.reduce((a, x) => a + num(x.gross), 0), [allocs]);
  const withheldTotal = useMemo(() => whs.reduce((a, x) => a + num(x.amount), 0), [whs]);
  const net = useMemo(() => grossTotal - withheldTotal, [grossTotal, withheldTotal]);

  const valid = vendorId && bankId && grossTotal > 0 && net > 0 && allocs.some((a) => num(a.gross) > 0);

  function submit() {
    if (!valid) return;
    setMsg(null);
    startTransition(async () => {
      const res = await registrarPagoConRetenciones({
        vendorId,
        paymentDate,
        paymentMethod: method,
        bankAccountId: bankId,
        operationNumber: operationNumber || undefined,
        allocations: allocs
          .filter((a) => num(a.gross) > 0)
          .map((a) => ({ supplierInvoiceId: a.invoiceId, grossAmount: num(a.gross) })),
        withholdings: whs
          .filter((w) => num(w.amount) > 0)
          .map((w) => ({
            withholdingType: w.type,
            jurisdiction: w.jurisdiction || undefined,
            taxBase: w.base ? num(w.base) : undefined,
            rate: w.rate ? num(w.rate) : undefined,
            amount: num(w.amount),
          })),
      });
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) {
        setAllocs((prev) => prev.map((a) => ({ ...a, gross: "" })));
        setWhs([]);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      {msg && (
        <div className={`card p-3 text-sm ${msg.ok ? "text-status-success" : "text-status-error"}`}>{msg.text}</div>
      )}
      {!canWrite && (
        <div className="card p-3 text-sm text-fg-muted">
          Solo lectura: registrar pagos requiere el permiso <code className="font-mono">tesoreria.create</code>.
        </div>
      )}

      <section className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="block text-fg-muted mb-1">Proveedor</span>
          <select value={vendorId} onChange={(e) => onVendorChange(e.target.value)} className="w-full border border-border-subtle rounded px-3 py-2">
            <option value="">— Elegí —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.razon}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-fg-muted mb-1">Fecha</span>
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full border border-border-subtle rounded px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="block text-fg-muted mb-1">Método</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full border border-border-subtle rounded px-3 py-2">
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-fg-muted mb-1">Banco / Caja</span>
          <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="w-full border border-border-subtle rounded px-3 py-2">
            {banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>
        <label className="text-sm lg:col-span-2">
          <span className="block text-fg-muted mb-1">N° operación (opcional)</span>
          <input value={operationNumber} onChange={(e) => setOperationNumber(e.target.value)} className="w-full border border-border-subtle rounded px-3 py-2" />
        </label>
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">
          Imputación bruta a facturas {vendorId ? "" : "(elegí un proveedor)"}
        </div>
        {allocs.length === 0 ? (
          <div className="p-6 text-sm text-fg-secondary">Sin facturas abiertas para imputar.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="px-4 py-1.5">Factura</th>
                <th className="px-4 py-1.5 text-right">Saldo</th>
                <th className="px-4 py-1.5 text-right">Imputar (bruto)</th>
              </tr>
            </thead>
            <tbody>
              {allocs.map((a, i) => (
                <tr key={a.invoiceId} className="border-t border-border-subtle/40">
                  <td className="px-4 py-1.5 font-mono text-xs">{a.publicId}</td>
                  <td className="px-4 py-1.5 text-right">{fmtCurrency(a.saldo)}</td>
                  <td className="px-4 py-1.5 text-right">
                    <input
                      type="number" step="0.01" min="0" max={a.saldo}
                      value={a.gross}
                      onChange={(e) => setAllocs((prev) => prev.map((x, j) => (j === i ? { ...x, gross: e.target.value } : x)))}
                      className="w-32 border border-border-subtle rounded px-2 py-1 text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-border-subtle flex items-center justify-between">
          <span className="font-semibold text-fg-brand">Retenciones practicadas</span>
          <button
            type="button"
            onClick={() => setWhs((p) => [...p, { type: "RETENCION_GANANCIAS", jurisdiction: "", base: "", rate: "", amount: "" }])}
            className="text-xs px-2 py-1 rounded border border-border-subtle hover:bg-bg-subtle"
          >
            + Agregar retención
          </button>
        </div>
        {whs.length === 0 ? (
          <div className="p-6 text-sm text-fg-secondary">Sin retenciones (pago sin retención = neto igual a bruto).</div>
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
              {whs.map((w, i) => (
                <tr key={i} className="border-t border-border-subtle/40">
                  <td className="px-4 py-1.5">
                    <select value={w.type} onChange={(e) => setWhs((p) => p.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} className="border border-border-subtle rounded px-2 py-1">
                      {WH_TYPES.map((t) => <option key={t} value={t}>{WITHHOLDING_LABEL[t] ?? t}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-1.5">
                    <input value={w.jurisdiction} onChange={(e) => setWhs((p) => p.map((x, j) => (j === i ? { ...x, jurisdiction: e.target.value } : x)))} className="w-28 border border-border-subtle rounded px-2 py-1" />
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" step="0.01" value={w.base} onChange={(e) => setWhs((p) => p.map((x, j) => (j === i ? { ...x, base: e.target.value } : x)))} className="w-28 border border-border-subtle rounded px-2 py-1 text-right" />
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" step="0.0001" value={w.rate} onChange={(e) => setWhs((p) => p.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} className="w-20 border border-border-subtle rounded px-2 py-1 text-right" />
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" step="0.01" value={w.amount} onChange={(e) => setWhs((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className="w-28 border border-border-subtle rounded px-2 py-1 text-right" />
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <button type="button" onClick={() => setWhs((p) => p.filter((_, j) => j !== i))} className="text-xs text-status-error">Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-6 text-sm">
          <div><span className="text-fg-muted">Bruto: </span><span className="font-semibold">{fmtCurrency(grossTotal)}</span></div>
          <div><span className="text-fg-muted">Retenciones: </span><span className="font-semibold">{fmtCurrency(withheldTotal)}</span></div>
          <div><span className="text-fg-muted">Neto a pagar: </span><span className={`font-bold ${net > 0 ? "text-fg-brand" : "text-status-error"}`}>{fmtCurrency(net)}</span></div>
        </div>
        <button
          type="button"
          disabled={!valid || !canWrite || pending}
          onClick={submit}
          className="btn-primary px-5 py-2 rounded disabled:opacity-50"
        >
          {pending ? "Registrando…" : "Registrar pago"}
        </button>
      </section>
      {net <= 0 && grossTotal > 0 && (
        <p className="text-xs text-status-error">El neto debe ser mayor a 0 (la retención no puede igualar o superar el bruto).</p>
      )}
    </div>
  );
}
