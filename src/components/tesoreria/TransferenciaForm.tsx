"use client";

import { useState, useTransition, type FormEvent } from "react";
import { registerTransferAction } from "@/lib/tesoreria/actions";
import type { BankAccount } from "@/lib/tesoreria/types";

const today = () => new Date().toISOString().slice(0, 10);

export function TransferenciaForm({ accounts }: { accounts: BankAccount[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [desc, setDesc] = useState("");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const r = await registerTransferAction({
        date,
        from_bank_account_id: from,
        to_bank_account_id: to,
        amount,
        description: desc || null,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setAmount("");
        setDesc("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="card p-5 grid gap-3 max-w-xl">
      <h3 className="font-semibold">Registrar transferencia</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label block mb-1.5">Banco origen</span>
          <select className="input" value={from} onChange={(e) => setFrom(e.target.value)} required>
            <option value="">Seleccionar…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.bank_name} · {a.account_name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label block mb-1.5">Banco destino</span>
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">Seleccionar…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.bank_name} · {a.account_name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label block mb-1.5">Importe</span>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
        </label>
        <label className="block">
          <span className="field-label block mb-1.5">Fecha</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>
      <label className="block">
        <span className="field-label block mb-1.5">Descripción</span>
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Opcional" />
      </label>
      {msg && <p className={msg.ok ? "text-green-600 text-sm" : "text-red-600 text-sm"}>{msg.text}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
        {pending ? "Registrando…" : "Registrar transferencia"}
      </button>
    </form>
  );
}
