"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { OrderRow, OrderItemRow } from "@/lib/pedidos/types";
import {
  updateOrderAction,
  addOrderItemAction,
  updateOrderItemAction,
  deleteOrderItemAction,
} from "../actions";

type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export function EditOrderForm({ order, items }: { order: OrderRow; items: OrderItemRow[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [hdr, setHdr] = useState({
    client_name: order.client_name,
    customer_ref: order.customer_ref ?? "",
    requested_date: order.requested_date ?? "",
    priority: String(order.priority),
    notes: order.notes ?? "",
  });
  const [newItem, setNewItem] = useState({ sku: "", description: "", quantity_requested: "", lot_constraint: "" });

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setErr(null);
      const res = await fn();
      if (!res.ok) setErr(res.error);
      // UI actualizada por revalidatePath('/pedidos/[id]') de la action (sin router.refresh → sin 503).
    });

  const saveHeader = () =>
    run(() => updateOrderAction(order.id, {
      client_name: hdr.client_name.trim(),
      customer_ref: hdr.customer_ref.trim() || null,
      requested_date: hdr.requested_date || null,
      priority: Number(hdr.priority) || 0,
      notes: hdr.notes.trim() || null,
    }));

  const addLine = () => {
    if (!newItem.sku.trim() || !newItem.description.trim() || Number(newItem.quantity_requested) <= 0) return;
    run(async () => {
      const res = await addOrderItemAction(order.id, {
        sku: newItem.sku.trim(),
        description: newItem.description.trim(),
        quantity_requested: Number(newItem.quantity_requested),
        lot_constraint: newItem.lot_constraint.trim() || null,
      });
      if (res.ok) setNewItem({ sku: "", description: "", quantity_requested: "", lot_constraint: "" });
      return res;
    });
  };

  return (
    <div className="nx-surface card card-pad mb-6">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-sm font-semibold">
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} /> Editar (borrador)
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-4">
          {err && (
            <div className="card card-pad border-status-danger/30 bg-status-danger/5 text-sm text-status-danger">{err}</div>
          )}

          {/* Cabecera */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Cliente" value={hdr.client_name} onChange={(v) => setHdr({ ...hdr, client_name: v })} />
            <Field label="Ref. cliente" value={hdr.customer_ref} onChange={(v) => setHdr({ ...hdr, customer_ref: v })} />
            <Field label="Fecha solicitada" type="date" value={hdr.requested_date} onChange={(v) => setHdr({ ...hdr, requested_date: v })} />
            <Field label="Prioridad" type="number" value={hdr.priority} onChange={(v) => setHdr({ ...hdr, priority: v })} />
            <Field label="Notas" value={hdr.notes} onChange={(v) => setHdr({ ...hdr, notes: v })} />
          </div>
          <div>
            <button onClick={saveHeader} disabled={pending} className="btn btn-primary btn-sm">
              <Icon name="check" size={12} /> Guardar cabecera
            </button>
          </div>

          {/* Líneas existentes */}
          <div className="flex flex-col gap-2">
            <div className="kpi-label">Líneas</div>
            {items.map((it) => (
              <EditItemRow key={it.id} item={it} orderId={order.id} disabled={pending}
                onRun={(fn) => run(fn)} editable={it.status === "pendiente"} />
            ))}
            {items.length === 0 && <div className="text-xs text-fg-muted">Sin líneas.</div>}
          </div>

          {/* Nueva línea */}
          <div className="rounded-lg border border-stroke-soft p-3 grid sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
            <label className="flex flex-col gap-1">
              <span className="kpi-label">SKU</span>
              <input className="input font-mono text-xs" value={newItem.sku} onChange={(e) => setNewItem({ ...newItem, sku: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 lg:col-span-2">
              <span className="kpi-label">Descripción</span>
              <input className="input" value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="kpi-label">Cantidad</span>
              <input type="number" className="input" value={newItem.quantity_requested} onChange={(e) => setNewItem({ ...newItem, quantity_requested: e.target.value })} />
            </label>
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1 flex-1">
                <span className="kpi-label">Lote (opc.)</span>
                <input className="input" value={newItem.lot_constraint} onChange={(e) => setNewItem({ ...newItem, lot_constraint: e.target.value })} />
              </label>
              <button onClick={addLine} disabled={pending} className="btn btn-ghost btn-sm" title="Agregar línea"><Icon name="plus" size={12} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditItemRow({
  item, orderId, disabled, editable, onRun,
}: {
  item: OrderItemRow; orderId: string; disabled: boolean; editable: boolean;
  onRun: (fn: () => Promise<ActionResult>) => void;
}) {
  const [v, setV] = useState({
    sku: item.sku,
    description: item.description,
    quantity_requested: String(item.quantity_requested),
    lot_constraint: item.lot_constraint ?? "",
  });

  return (
    <div className="rounded-lg border border-stroke-soft p-3 grid sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
      <label className="flex flex-col gap-1">
        <span className="kpi-label">SKU</span>
        <input className="input font-mono text-xs" value={v.sku} disabled={!editable} onChange={(e) => setV({ ...v, sku: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 lg:col-span-2">
        <span className="kpi-label">Descripción</span>
        <input className="input" value={v.description} disabled={!editable} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="kpi-label">Cantidad</span>
        <input type="number" className="input" value={v.quantity_requested} disabled={!editable} onChange={(e) => setV({ ...v, quantity_requested: e.target.value })} />
      </label>
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 flex-1">
          <span className="kpi-label">Lote (opc.)</span>
          <input className="input" value={v.lot_constraint} disabled={!editable} onChange={(e) => setV({ ...v, lot_constraint: e.target.value })} />
        </label>
        {editable ? (
          <>
            <button
              onClick={() => onRun(() => updateOrderItemAction(item.id, orderId, {
                sku: v.sku.trim(), description: v.description.trim(),
                quantity_requested: Number(v.quantity_requested), lot_constraint: v.lot_constraint.trim() || null,
              }))}
              disabled={disabled} className="btn btn-ghost btn-sm" title="Guardar línea"><Icon name="check" size={12} /></button>
            <button
              onClick={() => { if (confirm("¿Quitar la línea?")) onRun(() => deleteOrderItemAction(item.id, orderId)); }}
              disabled={disabled} className="btn btn-ghost btn-sm" title="Quitar línea"><Icon name="trash" size={12} /></button>
          </>
        ) : (
          <span className="text-[10px] text-fg-muted" title="Línea ya reservada — no editable">reservada</span>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="kpi-label">{label}</span>
      <input type={type} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
