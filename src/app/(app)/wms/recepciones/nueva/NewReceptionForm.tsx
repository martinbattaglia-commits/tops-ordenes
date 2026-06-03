"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import type { PositionOption, BusinessUnit } from "@/lib/wms/types";
import { createReceptionFull } from "../actions";

interface ItemRow {
  sku: string;
  description: string;
  lot_number: string;
  expiration_date: string;
  quantity: string;
  position_id: string;
}

const EMPTY_ITEM: ItemRow = {
  sku: "", description: "", lot_number: "", expiration_date: "", quantity: "", position_id: "",
};

const BU_OPTIONS: BusinessUnit[] = ["GENERAL", "ANMAT", "CORPORATE"];

export function NewReceptionForm({ positions }: { positions: PositionOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [header, setHeader] = useState({
    client_name: "",
    business_unit: "GENERAL" as BusinessUnit,
    requires_quarantine: false,
    numero_oc: "",
    numero_remito: "",
    transportista: "",
    patente: "",
    chofer: "",
  });
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);

  const isAnmat = header.business_unit === "ANMAT";

  const setItem = (i: number, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const itemInvalid = (it: ItemRow) =>
    !it.sku.trim() ||
    !it.description.trim() ||
    !it.quantity ||
    Number(it.quantity) <= 0 ||
    !it.position_id ||
    (isAnmat && (!it.lot_number.trim() || !it.expiration_date));

  const formInvalid = !header.client_name.trim() || items.length === 0 || items.some(itemInvalid);

  const submit = () =>
    start(async () => {
      setErr(null);
      const r = await createReceptionFull({
        header: { ...header },
        items: items.map((it) => ({
          sku: it.sku.trim(),
          description: it.description.trim(),
          lot_number: it.lot_number.trim() || null,
          expiration_date: it.expiration_date || null,
          quantity: Number(it.quantity),
          position_id: it.position_id || null,
        })),
      });
      if (!r.ok) setErr(r.error);
      else router.push("/wms/recepciones");
    });

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      {/* Cabecera */}
      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4">
          <div className="text-base font-bold text-fg-brand">Cabecera</div>
          {header.requires_quarantine && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-[#7c3aed1a] text-[#7c3aed]">
              <Icon name="lock" size={11} /> Ingresa en cuarentena
            </span>
          )}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="Cliente *">
            <input className="input w-full" value={header.client_name}
              onChange={(e) => setHeader({ ...header, client_name: e.target.value })} />
          </Field>
          <Field label="Business Unit">
            <select className="input w-full" value={header.business_unit}
              onChange={(e) => setHeader({ ...header, business_unit: e.target.value as BusinessUnit })}>
              {BU_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="N° OC"><input className="input w-full" value={header.numero_oc}
            onChange={(e) => setHeader({ ...header, numero_oc: e.target.value })} /></Field>
          <Field label="N° Remito"><input className="input w-full" value={header.numero_remito}
            onChange={(e) => setHeader({ ...header, numero_remito: e.target.value })} /></Field>
          <Field label="Transportista"><input className="input w-full" value={header.transportista}
            onChange={(e) => setHeader({ ...header, transportista: e.target.value })} /></Field>
          <Field label="Patente"><input className="input w-full" value={header.patente}
            onChange={(e) => setHeader({ ...header, patente: e.target.value })} /></Field>
          <Field label="Chofer"><input className="input w-full" value={header.chofer}
            onChange={(e) => setHeader({ ...header, chofer: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-fg-secondary cursor-pointer">
          <input type="checkbox" checked={header.requires_quarantine}
            onChange={(e) => setHeader({ ...header, requires_quarantine: e.target.checked })} />
          Requiere cuarentena (ingresa a stock reservado, pendiente de liberación)
        </label>
        {isAnmat && (
          <div className="mt-3 text-xs text-status-warning flex items-center gap-1.5">
            <Icon name="shield" size={13} /> ANMAT: lote y vencimiento obligatorios en cada ítem.
          </div>
        )}
      </div>

      {/* Ítems */}
      <div className="card card-pad">
        <div className="flex items-center justify-between mb-3">
          <div className="text-base font-bold text-fg-brand">Ítems ({items.length})</div>
          <button type="button" onClick={addItem} className="btn btn-ghost btn-sm">
            <Icon name="plus" size={13} /> Agregar ítem
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-stroke-soft p-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <Field label="SKU *"><input className="input w-full" value={it.sku}
                onChange={(e) => setItem(i, { sku: e.target.value })} /></Field>
              <Field label="Descripción *"><input className="input w-full" value={it.description}
                onChange={(e) => setItem(i, { description: e.target.value })} /></Field>
              <Field label="Cantidad *"><input type="number" min="0" step="0.001" className="input w-full" value={it.quantity}
                onChange={(e) => setItem(i, { quantity: e.target.value })} /></Field>
              <Field label="Posición destino *">
                <select className="input w-full font-mono text-xs" value={it.position_id}
                  onChange={(e) => setItem(i, { position_id: e.target.value })}>
                  <option value="">— elegir —</option>
                  {positions.map((p) => <option key={p.id} value={p.id}>{p.full_code}</option>)}
                </select>
              </Field>
              <Field label={isAnmat ? "Lote *" : "Lote"}>
                <input className="input w-full" value={it.lot_number}
                  onChange={(e) => setItem(i, { lot_number: e.target.value })} /></Field>
              <Field label={isAnmat ? "Vencimiento *" : "Vencimiento"}>
                <input type="date" className="input w-full" value={it.expiration_date}
                  onChange={(e) => setItem(i, { expiration_date: e.target.value })} /></Field>
              <div className="flex items-end justify-between sm:col-span-2 lg:col-span-2">
                {it.position_id && (
                  <span className="text-[10px] font-mono text-fg-muted truncate" title={positions.find((p) => p.id === it.position_id)?.full_code}>
                    {positions.find((p) => p.id === it.position_id)?.full_code}
                  </span>
                )}
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(i)} className="btn btn-ghost btn-sm text-status-danger ml-auto">
                    <Icon name="trash" size={13} /> Quitar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {err && (
        <div className="card card-pad border-status-danger/30 bg-status-danger/5 text-sm text-status-danger">
          {err}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => router.push("/wms/recepciones")} className="btn btn-ghost btn-sm">
          Cancelar
        </button>
        <button type="button" disabled={pending || formInvalid} onClick={submit}
          className="btn btn-primary btn-sm disabled:opacity-50">
          {pending ? "Guardando…" : "Crear recepción (pendiente)"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
