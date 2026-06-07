"use client";

/** Registrar pago a proveedor (ERP-A4). RPC-First: solo registerPaymentAction. */
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { registerPaymentAction } from "@/lib/tesoreria/actions";
import { PAYMENT_METHOD_VALUES, type BankAccount, type SupplierOpenItem } from "@/lib/tesoreria/types";
import { fmtCurrency } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);

export function PagoForm({ accounts, openItems }: { accounts: BankAccount[]; openItems: SupplierOpenItem[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [method, setMethod] = useState<string>("transferencia");
  const [bankId, setBankId] = useState("");
  const [operation, setOperation] = useState("");
  const [date, setDate] = useState(today);
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  const vendors = useMemo(() => Array.from(new Set(openItems.map((i) => i.vendor_id))), [openItems]);
  const items = useMemo(() => openItems.filter((i) => i.vendor_id === vendorId), [openItems, vendorId]);
  const amount = useMemo(() => Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0), [alloc]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const allocations = Object.entries(alloc)
      .filter(([, v]) => Number(v) > 0)
      .map(([supplier_invoice_id, amt]) => ({ supplier_invoice_id, amount: amt }));
    start(async () => {
      const r = await registerPaymentAction({
        vendor_id: vendorId,
        payment_date: date,
        payment_method: method,
        bank_account_id: bankId,
        amount: amount.toFixed(2),
        operation_number: operation || null,
        allocations,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setAlloc({});
    });
  }

  return (
    <form onSubmit={submit} className="card p-5 grid gap-3">
      <h3 className="font-semibold">Registrar pago</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label block mb-1.5">Proveedor</span>
          <select className="input" value={vendorId} onChange={(e) => { setVendorId(e.target.value); setAlloc({}); }} required>
            <option value="">Seleccionar…</option>
            {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="field-label block mb-1.5">Medio</span>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHOD_VALUES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="field-label block mb-1.5">Banco</span>
          <select className="input" value={bankId} onChange={(e) => setBankId(e.target.value)} required>
            <option value="">Seleccionar…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.bank_name} · {a.account_name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="field-label block mb-1.5">Nº operación</span>
          <input className="input" value={operation} onChange={(e) => setOperation(e.target.value)} placeholder="Opcional" />
        </label>
      </div>

      {vendorId && (
        <div className="border rounded p-3">
          <div className="field-label mb-2">Facturas a imputar (saldo de la vista)</div>
          {items.length === 0 && <p className="text-sm text-fg-muted">Sin facturas abiertas para este proveedor.</p>}
          {items.map((it) => (
            <div key={it.invoice_id} className="flex items-center justify-between gap-3 py-1 text-sm">
              <span className="tabular">{it.public_id} · saldo {fmtCurrency(it.saldo)}</span>
              <input
                className="input w-32"
                inputMode="decimal"
                placeholder="0.00"
                value={alloc[it.invoice_id] ?? ""}
                onChange={(e) => setAlloc((prev) => ({ ...prev, [it.invoice_id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-fg-muted">Total a pagar: <strong className="tabular">{fmtCurrency(amount)}</strong></span>
        <input type="date" className="input w-44" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {msg && <p className={msg.ok ? "text-green-600 text-sm" : "text-red-600 text-sm"}>{msg.text}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending || amount <= 0}>
        {pending ? "Registrando…" : "Registrar pago"}
      </button>
    </form>
  );
}
