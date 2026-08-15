"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PurchaseOrder } from "@/lib/types-po";
import { fmtCurrency } from "@/lib/compras/format";
import { PO_PRICE_STATE_LABEL } from "@/lib/compras/pricing";
import { reconcilePurchasePricesAction } from "./price-actions";

export function PriceReconciliationForm({
  po,
  invoiceId,
}: {
  po: PurchaseOrder;
  invoiceId: string;
}) {
  const router = useRouter();
  const items = useMemo(() => po.items ?? [], [po.items]);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    items.filter((item) => item.id).map((item) => [item.id!, item.actual_unit_price?.toString() ?? item.price?.toString() ?? ""]),
  ));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = useMemo(() => items.length > 0 && items.every((item) => {
    if (!item.id) return false;
    const raw = values[item.id];
    const n = Number(raw);
    return raw !== "" && Number.isFinite(n) && n >= 0;
  }) && reason.trim().length >= 3, [items, reason, values]);

  if (po.price_reconciled_at) {
    return (
      <section className="nx-surface rounded-xl p-5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-fg-primary">Precio real conciliado</h3>
          <span className="badge badge-success">Trazabilidad completa</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-fg-muted">Emitido:</span>{" "}
            {po.issued_total === null ? "Pendiente" : fmtCurrency(po.issued_total)}
          </div>
          <div><span className="text-fg-muted">Factura real:</span> {fmtCurrency(po.total)}</div>
        </div>
        <p className="text-xs text-fg-muted">Motivo: {po.price_reconciliation_reason}</p>
      </section>
    );
  }

  return (
    <section className="nx-surface rounded-xl p-5 space-y-4 border border-status-warning/30">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-fg-primary">Conciliar precios contra factura real</h3>
          <span className="badge badge-warning">{PO_PRICE_STATE_LABEL[po.price_state]}</span>
        </div>
        <p className="text-xs text-fg-muted mt-1">
          Este paso valida proveedor, vínculo OC/factura, moneda ARS y cierre del neto. No reemplaza
          lo emitido: conserva original, real, diferencia, motivo y responsable.
        </p>
      </div>

      <div className="space-y-2">
        {items.map((item, index) => item.id && (
          <label key={item.id} className="grid grid-cols-[1fr_150px] gap-3 items-center">
            <span className="text-sm text-fg-primary">
              {index + 1}. {item.label}
              <span className="block text-[11px] text-fg-muted">
                Emitido: {item.price === null ? "pendiente" : fmtCurrency(item.price)} · {item.qty} {item.unit}
              </span>
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="input text-right tabular"
              placeholder="Precio real"
              value={values[item.id] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [item.id!]: event.target.value }))}
            />
          </label>
        ))}
      </div>

      <textarea
        className="textarea"
        rows={2}
        maxLength={500}
        placeholder="Motivo / referencia de factura (obligatorio)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {error && <div className="text-xs text-tops-red">{error}</div>}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={!valid || pending}
        onClick={() => startTransition(async () => {
          setError(null);
          const result = await reconcilePurchasePricesAction({
            orderId: po.id,
            invoiceId,
            reason,
            lines: items.map((item) => ({
              item_id: item.id!,
              actual_unit_price: Number(values[item.id!]),
            })),
          });
          if (!result.ok) setError(result.error);
          else router.refresh();
        })}
      >
        {pending ? "Conciliando…" : "Registrar precio real"}
      </button>
    </section>
  );
}
