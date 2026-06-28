"use client";

/**
 * Registrar cobranza (ERP-A4). RPC-First: solo llama registerReceiptAction.
 * Los saldos por factura vienen de la vista (openItems.saldo) — no se calculan
 * acá. El "bruto" es el total de los importes que el usuario imputa (suma de
 * inputs del formulario), que la RPC re-valida (Σ allocations = bruto).
 */
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { registerReceiptAction } from "@/lib/tesoreria/actions";
import { RECEIPT_METHOD_VALUES, type BankAccount, type CustomerOpenItem } from "@/lib/tesoreria/types";
import { fmtMoney } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);

export function CobranzaForm({
  accounts,
  openItems,
  clientNames = {},
}: {
  accounts: BankAccount[];
  openItems: CustomerOpenItem[];
  /** client_id → nombre comercial (resuelto server-side). El <select> muestra el
   *  nombre, pero sigue enviando el client_id: el contrato de la RPC no cambia. */
  clientNames?: Record<string, string>;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [clientId, setClientId] = useState("");
  const [method, setMethod] = useState<string>("transferencia");
  const [bankId, setBankId] = useState("");
  const [retention, setRetention] = useState("0");
  const [date, setDate] = useState(today);
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  const clients = useMemo(
    () =>
      Array.from(new Set(openItems.map((i) => i.client_id).filter((x): x is string => !!x)))
        .map((id) => ({ id, name: clientNames[id] ?? `Cliente ${id.slice(0, 8)}` }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [openItems, clientNames]
  );
  const items = useMemo(() => openItems.filter((i) => i.client_id === clientId), [openItems, clientId]);
  const gross = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0),
    [alloc]
  );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const allocations = Object.entries(alloc)
      .filter(([, v]) => Number(v) > 0)
      .map(([invoice_id, amount]) => ({ invoice_id, amount }));
    start(async () => {
      const r = await registerReceiptAction({
        client_id: clientId,
        payment_date: date,
        payment_method: method,
        bank_account_id: bankId,
        gross_amount: gross.toFixed(2),
        retention_amount: (Number(retention) || 0).toFixed(2),
        allocations,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setAlloc({});
    });
  }

  return (
    <form onSubmit={submit} className="card p-5 grid gap-3">
      <h3 className="font-semibold">Registrar cobranza</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label block mb-1.5">Cliente</span>
          <select className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); setAlloc({}); }} required>
            <option value="">Seleccionar…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="field-label block mb-1.5">Medio</span>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {RECEIPT_METHOD_VALUES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="field-label block mb-1.5">Banco / Caja</span>
          <select className="input" value={bankId} onChange={(e) => setBankId(e.target.value)} required>
            <option value="">Seleccionar…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.bank_name} · {a.account_name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="field-label block mb-1.5">Retención</span>
          <input className="input" inputMode="decimal" value={retention} onChange={(e) => setRetention(e.target.value)} />
        </label>
      </div>

      {clientId && (
        <div className="border rounded p-3">
          <div className="field-label mb-2">Facturas a imputar (saldo de la vista)</div>
          {items.length === 0 && <p className="text-sm text-fg-muted">Sin facturas abiertas para este cliente.</p>}
          {items.map((it) => (
            <div key={it.invoice_id} className="flex items-center justify-between gap-3 py-1 text-sm">
              <span className="tabular">#{it.numero_comprobante ?? it.invoice_id.slice(0, 8)} · saldo {fmtMoney(it.saldo)}</span>
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
        <span className="text-sm text-fg-muted">Bruto imputado: <strong className="tabular">{fmtMoney(gross)}</strong></span>
        <input type="date" className="input w-44" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {msg && <p className={msg.ok ? "text-green-600 text-sm" : "text-red-600 text-sm"}>{msg.text}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending || gross <= 0}>
        {pending ? "Registrando…" : "Registrar cobranza"}
      </button>
    </form>
  );
}
