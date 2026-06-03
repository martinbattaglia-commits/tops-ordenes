"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { createOrderFull } from "../actions";

interface ItemRow {
  sku: string;
  description: string;
  quantity_requested: string;
  lot_constraint: string;
}

const EMPTY_ITEM: ItemRow = { sku: "", description: "", quantity_requested: "", lot_constraint: "" };

export function NewOrderForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [header, setHeader] = useState({
    client_name: "",
    customer_ref: "",
    requested_date: "",
    priority: "0",
    notes: "",
  });
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);

  const setItem = (i: number, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const itemInvalid = (it: ItemRow) =>
    !it.sku.trim() || !it.description.trim() || !it.quantity_requested || Number(it.quantity_requested) <= 0;
  const formInvalid = !header.client_name.trim() || items.length === 0 || items.some(itemInvalid);

  const submit = () =>
    start(async () => {
      setErr(null);
      const res = await createOrderFull({
        header: {
          client_name: header.client_name.trim(),
          customer_ref: header.customer_ref.trim() || null,
          requested_date: header.requested_date || null,
          priority: Number(header.priority) || 0,
          notes: header.notes.trim() || null,
        },
        items: items.map((it) => ({
          sku: it.sku.trim(),
          description: it.description.trim(),
          quantity_requested: Number(it.quantity_requested),
          lot_constraint: it.lot_constraint.trim() || null,
        })),
      });
      if (!res.ok) { setErr(res.error); return; }
      // Post-crear → detalle del pedido (borrador) para revisión/edición/envío.
      router.push(`/pedidos/${res.id}`);
    });

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {err && (
        <div className="card card-pad border-status-danger/30 bg-status-danger/5 text-sm text-status-danger">
          {err}
        </div>
      )}

      {/* Cabecera */}
      <div className="nx-surface card card-pad">
        <h2 className="text-sm font-semibold mb-3">Cabecera</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="kpi-label">Cliente *</span>
            <input className="input" value={header.client_name}
              onChange={(e) => setHeader({ ...header, client_name: e.target.value })} placeholder="Depositante" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="kpi-label">Ref. cliente</span>
            <input className="input" value={header.customer_ref}
              onChange={(e) => setHeader({ ...header, customer_ref: e.target.value })} placeholder="N° pedido del cliente" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="kpi-label">Fecha solicitada</span>
            <input type="date" className="input" value={header.requested_date}
              onChange={(e) => setHeader({ ...header, requested_date: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="kpi-label">Prioridad</span>
            <input type="number" className="input" value={header.priority}
              onChange={(e) => setHeader({ ...header, priority: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="kpi-label">Notas</span>
            <input className="input" value={header.notes}
              onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
          </label>
        </div>
      </div>

      {/* Líneas */}
      <div className="nx-surface card card-pad">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Líneas</h2>
          <button onClick={addItem} className="btn btn-ghost btn-sm"><Icon name="plus" size={12} /> Agregar línea</button>
        </div>
        <div className="flex flex-col gap-2">
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-stroke-soft p-3 grid sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
              <label className="flex flex-col gap-1">
                <span className="kpi-label">SKU *</span>
                <input className="input font-mono text-xs" value={it.sku} onChange={(e) => setItem(i, { sku: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 lg:col-span-2">
                <span className="kpi-label">Descripción *</span>
                <input className="input" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="kpi-label">Cantidad *</span>
                <input type="number" className="input" value={it.quantity_requested}
                  onChange={(e) => setItem(i, { quantity_requested: e.target.value })} />
              </label>
              <div className="flex items-end gap-2">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="kpi-label">Lote (opc.)</span>
                  <input className="input" value={it.lot_constraint} onChange={(e) => setItem(i, { lot_constraint: e.target.value })} />
                </label>
                {items.length > 1 && (
                  <button onClick={() => removeItem(i)} className="btn btn-ghost btn-sm" title="Quitar línea">
                    <Icon name="trash" size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={pending || formInvalid} className="btn btn-primary btn-sm">
          <Icon name="check" size={14} /> {pending ? "Creando…" : "Crear pedido"}
        </button>
        <button onClick={() => router.push("/pedidos")} className="btn btn-ghost btn-sm">Cancelar</button>
      </div>
    </div>
  );
}
