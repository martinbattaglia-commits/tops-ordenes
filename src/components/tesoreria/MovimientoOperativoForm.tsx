"use client";

/**
 * Registrar movimiento operativo de Tesorería (operatoria diaria, sin proveedor).
 * RPC-First: solo registerOperationalMovementAction. Ninguna regla financiera acá.
 *
 * Una sola cuenta (ingreso o egreso). Las transferencias entre cuentas NO se
 * gestionan acá: usan el flujo de Transferencias existente (no se duplica lógica).
 */
import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerOperationalMovementAction } from "@/lib/tesoreria/actions";
import {
  OPERATIONAL_CATEGORY_VALUES,
  OPERATIONAL_CATEGORY_LABELS,
  OPERATIONAL_CATEGORY_DIRECTION,
  type BankAccount,
  type OperationalCategory,
} from "@/lib/tesoreria/types";

const today = () => new Date().toISOString().slice(0, 10);

export function MovimientoOperativoForm({ accounts }: { accounts: BankAccount[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [category, setCategory] = useState<OperationalCategory>("gasto_operativo");
  const [direction, setDirection] = useState<string>(OPERATIONAL_CATEGORY_DIRECTION["gasto_operativo"] ?? "egreso");
  const [bankId, setBankId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [concept, setConcept] = useState("");

  function onCategory(next: OperationalCategory) {
    setCategory(next);
    const suggested = OPERATIONAL_CATEGORY_DIRECTION[next];
    if (suggested) setDirection(suggested);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const r = await registerOperationalMovementAction({
        date,
        category,
        direction,
        bank_account_id: bankId,
        amount,
        concept,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setAmount("");
        setConcept("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="card p-5 grid gap-3 max-w-xl">
      <h3 className="font-semibold">Registrar movimiento operativo</h3>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label block mb-1.5">Tipo de movimiento</span>
          <select className="input" value={category} onChange={(e) => onCategory(e.target.value as OperationalCategory)}>
            {OPERATIONAL_CATEGORY_VALUES.map((c) => (
              <option key={c} value={c}>{OPERATIONAL_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="field-label block mb-1.5">Dirección</span>
          <select className="input" value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="egreso">Egreso (sale dinero)</option>
            <option value="ingreso">Ingreso (entra dinero)</option>
          </select>
        </label>

        <label className="block">
          <span className="field-label block mb-1.5">Cuenta</span>
          <select className="input" value={bankId} onChange={(e) => setBankId(e.target.value)} required>
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
        <span className="field-label block mb-1.5">Concepto</span>
        <input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej.: Adelanto a Dirección — septiembre" required />
      </label>

      {msg && <p className={msg.ok ? "text-green-600 text-sm" : "text-red-600 text-sm"}>{msg.text}</p>}

      <div className="flex items-center justify-between gap-3">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? "Registrando…" : "Registrar movimiento"}
        </button>
        <span className="text-xs text-fg-muted">
          ¿Transferencia entre cuentas? <Link href="/tesoreria/bancos" className="fg-link underline">Usá Transferencias</Link>
        </span>
      </div>
    </form>
  );
}
