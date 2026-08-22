"use client";

/** Registrar pago a proveedor (ERP-A4). RPC-First: solo registerPaymentAction. */
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { registerPaymentAction } from "@/lib/tesoreria/actions";
import { PAYMENT_METHOD_VALUES, type BankAccount, type SupplierOpenItem } from "@/lib/tesoreria/types";
import type { FinanceForecastAdjustment } from "@/lib/finanzas/types";
import { fmtMoney } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);

export function PagoForm({
  accounts,
  openItems,
  vendorNames = {},
  forecastAdjustments = [],
}: {
  accounts: BankAccount[];
  openItems: SupplierOpenItem[];
  /** vendor_id → nombre comercial (resuelto server-side). El <select> muestra el
   *  nombre, pero sigue enviando el vendor_id: el contrato de la RPC no cambia. */
  vendorNames?: Record<string, string>;
  forecastAdjustments?: FinanceForecastAdjustment[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [method, setMethod] = useState<string>("transferencia");
  const [bankId, setBankId] = useState("");
  const [operation, setOperation] = useState("");
  const [date, setDate] = useState(today);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [forecastId, setForecastId] = useState<string>("");
  const [forecastAppliedAmount, setForecastAppliedAmount] = useState<string>("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  const vendors = useMemo(
    () =>
      Array.from(new Set(openItems.map((i) => i.vendor_id).filter((x): x is string => !!x)))
        .map((id) => ({ id, name: vendorNames[id] ?? `Proveedor ${id.slice(0, 8)}` }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [openItems, vendorNames]
  );
  const items = useMemo(() => openItems.filter((i) => i.vendor_id === vendorId), [openItems, vendorId]);
  const amount = useMemo(() => Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0), [alloc]);

  // Previsiones de egreso abiertas/programadas
  const compatibleForecasts = useMemo(
    () => forecastAdjustments.filter((f) => f.direction === "egreso" && f.status !== "reconciliado" && f.status !== "anulado"),
    [forecastAdjustments]
  );

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
        forecast_adjustment_id: forecastId || null,
        forecast_applied_amount: forecastAppliedAmount.trim() ? Number(forecastAppliedAmount).toFixed(2) : null,
        idempotency_key: idempotencyKey,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setAlloc({});
        setForecastId("");
        setForecastAppliedAmount("");
        setIdempotencyKey(crypto.randomUUID());
      }
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
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
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

      {/* Selector de Reconciliación con Previsión Financiera */}
      {compatibleForecasts.length > 0 && (
        <div className="grid gap-2 p-3 bg-bg-surface-alt/50 border border-tops-blue-700/30 rounded">
          <label className="block">
            <span className="field-label block mb-1.5 text-tops-blue-700 dark:text-blue-400 font-bold">
              Vincular con Previsión Financiera (Finanzas ↔ Tesorería)
            </span>
            <select
              className="input bg-bg-surface border-tops-blue-700/30"
              value={forecastId}
              onChange={(e) => {
                setForecastId(e.target.value);
                if (!e.target.value) setForecastAppliedAmount("");
              }}
            >
              <option value="">Sin previsión previa (Pago extraordinario / ad-hoc)</option>
              {compatibleForecasts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.date} · {f.concept} ({fmtMoney(Number(f.amount))}) {f.counterpart ? `· ${f.counterpart}` : ""}
                </option>
              ))}
            </select>
          </label>
          {forecastId && (
            <label className="block">
              <span className="field-label block mb-1 text-xs text-fg-muted">
                Importe a aplicar a la previsión (vacío = importe total del pago)
              </span>
              <input
                className="input text-sm"
                inputMode="decimal"
                placeholder="Monto parcial (ej. 2000000.00) o vacío para aplicar importe completo"
                value={forecastAppliedAmount}
                onChange={(e) => setForecastAppliedAmount(e.target.value)}
              />
            </label>
          )}
        </div>
      )}

      {vendorId && (
        <div className="border rounded p-3">
          <div className="field-label mb-2">Facturas a imputar (saldo de la vista)</div>
          {items.length === 0 && <p className="text-sm text-fg-muted">Sin facturas abiertas para este proveedor.</p>}
          {items.map((it) => (
            <div key={it.invoice_id} className="flex items-center justify-between gap-3 py-1 text-sm">
              <span className="tabular">{it.public_id} · saldo {fmtMoney(it.saldo)}</span>
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
        <span className="text-sm text-fg-muted">Total a pagar: <strong className="tabular">{fmtMoney(amount)}</strong></span>
        <input type="date" className="input w-44" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {msg && <p className={msg.ok ? "text-green-600 text-sm" : "text-red-600 text-sm"}>{msg.text}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending || amount <= 0}>
        {pending ? "Registrando…" : "Registrar pago"}
      </button>
    </form>
  );
}
