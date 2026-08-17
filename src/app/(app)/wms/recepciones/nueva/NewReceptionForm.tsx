"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { PositionOption, BusinessUnit } from "@/lib/wms/types";
import {
  ClientSelector,
  EMPTY_CLIENT_SELECTION,
  clientSelectionValid,
  toClientSelectionPayload,
  type ClientSelectOptionUI,
  type ClientSelectionState,
} from "@/components/ClientSelector";
import {
  createReceptionFull,
  createConfirmAndCaptureAction,
  type CreateAndCaptureResult,
} from "../actions";
import { custodyClientLevelAction } from "../actions";

interface ItemRow {
  sku: string;
  description: string;
  lot_number: string;
  expiration_date: string;
  quantity: string;
  position_id: string;
  /** I4 · foto de ingreso, tomada donde ocurre el hecho. */
  foto: File | null;
}

const EMPTY_ITEM: ItemRow = {
  sku: "", description: "", lot_number: "", expiration_date: "", quantity: "", position_id: "",
  foto: null,
};

const BU_OPTIONS: BusinessUnit[] = ["GENERAL", "ANMAT", "CORPORATE"];

export function NewReceptionForm({
  positions,
  clients,
}: {
  positions: PositionOption[];
  clients: ClientSelectOptionUI[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [cliente, setCliente] = useState<ClientSelectionState>(EMPTY_CLIENT_SELECTION);
  const [header, setHeader] = useState({
    business_unit: "GENERAL" as BusinessUnit,
    requires_quarantine: false,
    numero_oc: "",
    numero_remito: "",
    transportista: "",
    patente: "",
    chofer: "",
  });
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);
  /**
   * D3 · casilla de custodia reforzada. Su valor por defecto sale de la bandera
   * del cliente; el operario puede ELEVAR un ingreso puntual, nunca degradarlo.
   */
  const [reforzada, setReforzada] = useState(false);
  const [nivelCliente, setNivelCliente] = useState<1 | 2 | null>(null);
  const [resultado, setResultado] = useState<CreateAndCaptureResult | null>(null);

  const isAnmat = header.business_unit === "ANMAT";
  const conFotos = items.filter((it) => it.foto !== null).length;

  // El nivel contratado del cliente llega del servidor: `clients` exige
  // `clientes.view` por RLS y un encargado de depósito no lo tiene, así que la
  // pantalla no puede leer el maestro por su cuenta.
  useEffect(() => {
    const id = cliente.client_id;
    if (!id) { setNivelCliente(null); setReforzada(false); return; }
    let vigente = true;
    void custodyClientLevelAction(id).then((r) => {
      if (!vigente) return;
      const nivel = r.ok && r.data ? r.data : 1;
      setNivelCliente(nivel);
      setReforzada(nivel === 2);
    });
    return () => { vigente = false; };
  }, [cliente.client_id]);

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

  const formInvalid = !clientSelectionValid(cliente) || items.length === 0 || items.some(itemInvalid);

  const payload = () => ({
    header: { ...header, ...toClientSelectionPayload(cliente), custody_reforzada: reforzada },
    items: items.map((it) => ({
      sku: it.sku.trim(),
      description: it.description.trim(),
      lot_number: it.lot_number.trim() || null,
      expiration_date: it.expiration_date || null,
      quantity: Number(it.quantity),
      position_id: it.position_id || null,
    })),
  });

  const submit = () =>
    start(async () => {
      setErr(null);

      // SIN fotos: comportamiento de siempre. Crear y dejar pendiente; confirmar
      // sigue siendo un acto operativo aparte, desde el listado.
      if (conFotos === 0) {
        const r = await createReceptionFull(payload());
        if (!r.ok) setErr(r.error);
        else router.push("/wms/recepciones");
        return;
      }

      // CON fotos: hay que confirmar, porque el caso de custodia no existe
      // hasta que el trigger lo materializa, y ese trigger corre al confirmar.
      const form = new FormData();
      form.set("payload", JSON.stringify(payload()));
      items.forEach((it, i) => { if (it.foto) form.set(`foto-${i}`, it.foto); });
      const r = await createConfirmAndCaptureAction(form);
      if (!r.ok) { setErr(r.error); return; }
      setResultado(r.data ?? null);
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
            <ClientSelector options={clients} value={cliente} onChange={setCliente} />
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
        {/* D3 · el nivel de custodia se contrata por cliente; la casilla eleva
            un ingreso puntual. Nunca degrada: si el cliente ya es nivel 2, se
            informa y no se ofrece bajarlo. */}
        <label className="flex items-center gap-2 mt-3 text-sm text-fg-secondary cursor-pointer">
          <input
            type="checkbox"
            data-custodia="reforzada"
            checked={reforzada}
            disabled={nivelCliente === 2}
            onChange={(e) => setReforzada(e.target.checked)}
          />
          Esta mercadería ingresa por custodia digital reforzada
        </label>
        <p className="mt-1 text-xs text-fg-muted">
          {nivelCliente === 2
            ? "El cliente tiene custodia reforzada contratada: todos sus ingresos abren caso."
            : nivelCliente === 1
              ? "El cliente no la tiene contratada. Marcala para elevar SÓLO este ingreso."
              : "Elegí el cliente para conocer su nivel contratado."}
        </p>

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
              {/* I4 · la foto de ingreso se toma DONDE OCURRE EL HECHO. Un
                  input por slot, con la cámara del operario (§7.5). */}
              <div className="sm:col-span-2 lg:col-span-2">
                <label
                  htmlFor={`foto-ingreso-${i}`}
                  className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted"
                >
                  Foto de ingreso
                </label>
                <input
                  id={`foto-ingreso-${i}`}
                  data-foto-ingreso={i}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="input mt-1 w-full"
                  onChange={(e) => setItem(i, { foto: e.target.files?.[0] ?? null })}
                />
                <p className="mt-1 text-xs text-fg-muted">
                  {it.foto
                    ? "Lista. Se liga a la unidad al confirmar."
                    : "Fotografiá el embalaje antes de abrirlo. Opcional."}
                </p>
              </div>

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
        <div className="card card-pad text-sm text-status-danger">{err}</div>
      )}

      {/* S2-2 · AVISO ANTES DE CONFIRMAR. El operario tiene que saber qué va a
          generar su clic, no descubrirlo después. */}
      {resultado === null && conFotos > 0 && (
        <div className="card card-pad" role="status" data-aviso="custodia">
          <p className="flex items-center gap-2 text-sm text-status-warning">
            <Icon name="shield" size={14} aria-hidden="true" />
            <span>
              Esto va a <strong>confirmar la recepción</strong> y generar{" "}
              <strong>{items.length} {items.length === 1 ? "unidad" : "unidades"}</strong> bajo
              custodia digital, con {conFotos} {conFotos === 1 ? "foto" : "fotos"} de ingreso.
            </span>
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {reforzada
              ? "Nivel 2 · reforzada: cada unidad abre un caso con QR, análisis y decisión humana."
              : "Nivel 1 · universal: la foto queda como evidencia. Sin caso, sin análisis, sin gate de despacho."}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            La foto no puede ligarse antes: la unidad nace al confirmar.
          </p>
        </div>
      )}

      {/* S2-2 · DESPUÉS DE CONFIRMAR: la lista de unidades, con enlace al caso. */}
      {resultado !== null && (
        <div className="card card-pad" data-resultado="custodia">
          <div className="text-base font-bold text-fg-brand">
            Recepción confirmada · {resultado.units.length}{" "}
            {resultado.units.length === 1 ? "unidad creada" : "unidades creadas"}
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {resultado.units.map((u) => (
              <li
                key={u.physicalUnitId}
                className="flex flex-wrap items-center gap-2 rounded border border-stroke-soft p-2 text-sm"
              >
                <span className="badge font-mono">{u.unitPublicId}</span>
                <span className="text-fg-secondary">
                  {u.sku} · {u.quantity} un.{u.lotNumber ? ` · lote ${u.lotNumber}` : ""}
                </span>
                <span className="text-xs text-fg-muted">
                  {u.custodyLevel === 2 ? "Nivel 2 · reforzada" : "Nivel 1 · universal"}
                </span>
                <span className={u.hasIngressPhoto ? "text-xs text-status-success" : "text-xs text-status-warning"}>
                  {u.hasIngressPhoto ? "foto de ingreso registrada" : "foto de ingreso pendiente"}
                </span>
                {u.caseId && (
                  <Link href={`/wms/custody/${u.caseId}`} className="btn btn-ghost btn-sm ml-auto">
                    Ver caso {u.casePublicId ?? ""}
                  </Link>
                )}
              </li>
            ))}
          </ul>

          {resultado.fotosPendientes.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-status-warning">
                La recepción quedó confirmada, pero estas fotos no se registraron:
              </p>
              <ul className="mt-1 list-disc pl-4 text-xs text-fg-muted">
                {resultado.fotosPendientes.map((f, i) => (
                  <li key={i}>{f.sku} — {f.motivo}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-fg-muted">
                Se pueden registrar desde el caso de cada unidad.
              </p>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => router.push("/wms/recepciones")}
              className="btn btn-primary btn-sm"
            >
              Volver a recepciones
            </button>
          </div>
        </div>
      )}

      {resultado === null && (
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => router.push("/wms/recepciones")} className="btn btn-ghost btn-sm">
            Cancelar
          </button>
          {/* El botón DICE cuál de los dos actos ejecuta. Confirmar mueve stock:
              no puede quedar escondido detrás de un rótulo genérico. */}
          <button type="button" disabled={pending || formInvalid} onClick={submit}
            className="btn btn-primary btn-sm disabled:opacity-50">
            {pending
              ? "Guardando…"
              : conFotos > 0
                ? "Confirmar recepción y registrar fotos"
                : "Crear recepción (pendiente)"}
          </button>
        </div>
      )}
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
