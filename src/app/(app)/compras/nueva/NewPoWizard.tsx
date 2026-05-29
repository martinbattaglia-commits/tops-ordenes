"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { SignaturePad, type SignaturePadHandle } from "@/components/compras/SignaturePad";
import { PdfPreview } from "@/components/compras/PdfPreview";
import {
  fmtCurrency,
  fmtCurrencyShort,
  fmtDate,
  fmtCuit,
  validateCuit,
} from "@/lib/compras/format";
import { computeTotals, lineSubtotal } from "@/lib/compras/totals";
import { POSITIVE_CATEGORIES, COND_PAGO_OPTIONS, ORG } from "@/lib/org";
import type { Vendor, Product, POItem } from "@/lib/types-po";
import type { Depot } from "@/lib/types";
import { createPurchaseOrderAction } from "./actions";

interface Draft {
  vendor: {
    id: string | null;
    razon: string;
    cuit: string;
    domicilio: string;
    telefono: string;
    contacto: string;
    email: string;
  };
  depot: Depot;
  destino: string;
  entrega: string; // YYYY-MM-DD o texto libre
  categoria: string;
  cond_pago: string;
  items: POItem[];
  observ: string;
  signed: boolean;
  signatureDataUrl: string | null;
  signatureHash: string | null;
}

interface Props {
  vendors: Vendor[];
  products: Product[];
}

const EMPTY_ITEM = (pos: number): POItem => ({
  sku: null,
  label: "",
  unit: "un",
  qty: 1,
  price: 0,
  subtotal: 0,
  pos,
});

const STEPS = ["Proveedor", "Datos generales", "Productos", "Firma"] as const;

export function NewPoWizard({ vendors, products }: Props) {
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => ({
    vendor: {
      id: null,
      razon: "",
      cuit: "",
      domicilio: "",
      telefono: "",
      contacto: "",
      email: "",
    },
    depot: "MAGALDI",
    destino: "Depósito Magaldi · CABA",
    entrega: "Inmediata",
    categoria: POSITIVE_CATEGORIES[0],
    cond_pago: "30 días",
    items: [EMPTY_ITEM(0)],
    observ: "",
    signed: false,
    signatureDataUrl: null,
    signatureHash: null,
  }));

  const totals = useMemo(() => computeTotals(draft.items), [draft.items]);

  const cuitOk = validateCuit(draft.vendor.cuit);

  const canStep1 =
    draft.vendor.razon.trim().length >= 2 &&
    draft.vendor.cuit.replace(/\D/g, "").length === 11 &&
    draft.vendor.email.includes("@");
  const canStep2 =
    !!draft.depot && !!draft.categoria && !!draft.cond_pago && !!draft.entrega;
  const canStep3 =
    draft.items.length > 0 && draft.items.every((it) => it.label.trim().length > 0 && it.qty > 0);
  const canStep4 = draft.signed;

  const stepReady = [canStep1, canStep2, canStep3, canStep4];

  const next = () => {
    if (!stepReady[stepIdx]) return;
    if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
  };
  const prev = () => stepIdx > 0 && setStepIdx(stepIdx - 1);

  const onSubmit = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await createPurchaseOrderAction({
        vendor: draft.vendor,
        depot: draft.depot,
        destino: draft.destino,
        entrega: draft.entrega,
        categoria: draft.categoria,
        cond_pago: draft.cond_pago,
        items: draft.items.map((it, i) => ({ ...it, pos: i })),
        observ: draft.observ,
        signature: {
          signed_by: ORG.emitter.name,
          data_url: draft.signatureDataUrl ?? "",
          hash: draft.signatureHash ?? "",
        },
      });
      if (res.ok) {
        router.push(`/compras/ordenes/${res.public_id}?just_created=1`);
      } else {
        setError(res.error ?? "No se pudo crear la OC");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-7 lg:p-8">
      {/* Breadcrumb + stepper */}
      <div className="mb-6 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs text-fg-secondary">
          <Link href="/compras/ordenes" className="hover:text-fg-primary">
            Órdenes de compra
          </Link>
          <Icon name="chevron-right" size={12} />
          <span className="text-fg-primary font-semibold">Nueva</span>
          <span className="badge badge-success ml-2 hidden sm:inline-flex">
            <span className="dot" />
            Auto-guardado
          </span>
        </div>
        <Stepper stepIdx={stepIdx} stepReady={stepReady} onJump={(i) => i < stepIdx && setStepIdx(i)} />
      </div>

      <div
        className="grid gap-4 md:gap-6 items-start"
        style={{ gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)" }}
      >
        {/* COLUMNA IZQ — formulario */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 md:px-6 md:py-5 border-b border-stroke-soft">
            <div className="eyebrow-tiny">Paso {stepIdx + 1} de {STEPS.length}</div>
            <h2 className="text-xl md:text-2xl font-bold text-fg-brand">{STEPS[stepIdx]}</h2>
            <p className="text-sm text-fg-secondary mt-1">{stepSubtitle(stepIdx)}</p>
          </div>

          <div className="p-5 md:p-6">
            {stepIdx === 0 && (
              <VendorStep vendors={vendors} draft={draft} setDraft={setDraft} cuitOk={cuitOk} />
            )}
            {stepIdx === 1 && <GeneralStep draft={draft} setDraft={setDraft} />}
            {stepIdx === 2 && (
              <ProductsStep products={products} draft={draft} setDraft={setDraft} totals={totals} />
            )}
            {stepIdx === 3 && (
              <SignatureStep
                draft={draft}
                setDraft={setDraft}
                totals={totals}
                onSubmit={onSubmit}
                saving={saving}
                error={error}
              />
            )}
          </div>

          {stepIdx < STEPS.length - 1 && (
            <div className="px-5 md:px-6 py-4 border-t border-stroke-soft flex items-center justify-between bg-neutral-50">
              <button
                type="button"
                onClick={prev}
                disabled={stepIdx === 0}
                className="btn btn-ghost btn-sm"
              >
                <Icon name="arrow-left" size={14} />
                Atrás
              </button>
              <div className="text-xs text-fg-secondary tabular">
                Subtotal estimado:{" "}
                <span className="font-bold text-fg-brand">{fmtCurrencyShort(totals.total)}</span>
              </div>
              <button
                type="button"
                onClick={next}
                disabled={!stepReady[stepIdx]}
                className="btn btn-primary btn-sm"
              >
                Continuar
                <Icon name="arrow-right" size={14} />
              </button>
            </div>
          )}
        </div>

        {/* COLUMNA DER — Live PDF preview */}
        <aside className="hidden lg:block sticky top-4">
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-stroke-soft flex items-center justify-between">
              <div>
                <div className="eyebrow-tiny">Vista previa · A4</div>
                <div className="text-sm font-bold text-fg-primary">Lo que verá el proveedor</div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-fg-secondary">
                <span className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
                Sincronizado
              </div>
            </div>
            <div className="p-4" style={{ transform: "scale(0.92)", transformOrigin: "top center" }}>
              <PdfPreview
                po={{
                  public_id: "OC-2026-NUEVA",
                  date: new Date().toISOString(),
                  vendor: synthVendor(draft.vendor),
                  destino: draft.destino,
                  entrega: draft.entrega,
                  categoria: draft.categoria,
                  cond_pago: draft.cond_pago,
                  items: draft.items.filter((it) => it.label),
                  neto: totals.neto,
                  iva: totals.iva,
                  total: totals.total,
                  signed_by: draft.signed ? ORG.emitter.name : null,
                  signed_at: draft.signed ? new Date().toISOString() : null,
                }}
                signatureDataUrl={draft.signatureDataUrl}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function stepSubtitle(i: number): string {
  switch (i) {
    case 0:
      return "Buscá el proveedor existente o cargá uno nuevo. El CUIT se valida con módulo 11.";
    case 1:
      return "Destino del despacho, condición de pago, categoría contable y entrega.";
    case 2:
      return "Cargá los productos del catálogo o tipeá libre. Los totales se calculan automáticamente.";
    case 3:
      return "Único habilitado: José Luis Battaglia, Director de Operaciones. Tu firma queda hasheada con SHA-256.";
    default:
      return "";
  }
}

function synthVendor(v: Draft["vendor"]): Vendor {
  return {
    id: v.id ?? "draft",
    razon: v.razon || "Proveedor sin nombre",
    cuit: v.cuit || "—",
    domicilio: v.domicilio,
    telefono: v.telefono,
    contacto: v.contacto,
    email: v.email,
    categoria: null,
    cond_pago: "30 días",
    tags: [],
    active: true,
    created_at: new Date().toISOString(),
  };
}

// =========================== STEPPER ===========================

function Stepper({
  stepIdx,
  stepReady,
  onJump,
}: {
  stepIdx: number;
  stepReady: boolean[];
  onJump: (i: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {STEPS.map((label, i) => {
        const done = i < stepIdx && stepReady[i];
        const active = i === stepIdx;
        const clickable = i < stepIdx;
        return (
          <div key={label} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => clickable && onJump(i)}
              className={[
                "flex items-center gap-2 text-xs md:text-sm font-bold transition-colors",
                done ? "text-status-success" : active ? "text-fg-brand" : "text-fg-muted",
                clickable ? "cursor-pointer hover:opacity-80" : "cursor-default",
              ].join(" ")}
            >
              <span
                className={[
                  "w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold transition-colors",
                  done
                    ? "bg-status-success text-white"
                    : active
                      ? "bg-tops-blue-900 text-white"
                      : "bg-neutral-100 text-fg-secondary",
                ].join(" ")}
              >
                {done ? <Icon name="check" size={12} stroke={2.4} /> : i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className="hidden md:inline w-8 h-px bg-stroke-strong" />}
          </div>
        );
      })}
    </div>
  );
}

// =========================== STEP 1 — Vendor ===========================

function VendorStep({
  vendors,
  draft,
  setDraft,
  cuitOk,
}: {
  vendors: Vendor[];
  draft: Draft;
  setDraft: (next: Draft | ((d: Draft) => Draft)) => void;
  cuitOk: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const lo = q.toLowerCase();
    if (!lo) return vendors.slice(0, 10);
    return vendors
      .filter(
        (v) =>
          v.razon.toLowerCase().includes(lo) ||
          v.cuit.includes(lo) ||
          (v.contacto ?? "").toLowerCase().includes(lo)
      )
      .slice(0, 10);
  }, [q, vendors]);

  const pick = (v: Vendor) => {
    setDraft((d) => ({
      ...d,
      vendor: {
        id: v.id,
        razon: v.razon,
        cuit: v.cuit,
        domicilio: v.domicilio ?? "",
        telefono: v.telefono ?? "",
        contacto: v.contacto ?? "",
        email: v.email ?? "",
      },
      categoria: v.categoria ?? d.categoria,
      cond_pago: v.cond_pago ?? d.cond_pago,
    }));
    setOpen(false);
    setQ("");
  };

  return (
    <div className="space-y-5">
      {/* Búsqueda inteligente */}
      <div className="relative">
        <label className="field-label">Buscar proveedor existente</label>
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            type="search"
            placeholder="Razón social, CUIT o contacto"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="input pl-9"
          />
        </div>

        {open && matches.length > 0 && (
          <ul className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-stroke-soft rounded-md shadow-md max-h-96 overflow-y-auto">
            {matches.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => pick(v)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-50 text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-tops-blue-700 text-white grid place-items-center text-xs font-bold flex-shrink-0">
                    {v.avatar ?? v.razon.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-fg-primary truncate">{v.razon}</div>
                    <div className="text-[11px] text-fg-muted">
                      {fmtCuit(v.cuit)} · {v.oc_count ?? 0} OC · {v.last_oc_at ? fmtDate(v.last_oc_at) : "—"}
                    </div>
                  </div>
                  <div className="hidden md:flex gap-1 flex-shrink-0">
                    {v.tags.slice(0, 2).map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded bg-neutral-100 text-[10px] font-bold text-fg-secondary"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Form fields */}
      <div className="grid md:grid-cols-3 gap-4">
        <Field label="Razón social" required cs={2}>
          <input
            className="input"
            value={draft.vendor.razon}
            onChange={(e) => setDraft((d) => ({ ...d, vendor: { ...d.vendor, razon: e.target.value } }))}
          />
        </Field>
        <Field label="CUIT" required>
          <div className="relative">
            <input
              className="input pr-10"
              placeholder="30-12345678-9"
              value={draft.vendor.cuit}
              onChange={(e) =>
                setDraft((d) => ({ ...d, vendor: { ...d.vendor, cuit: e.target.value } }))
              }
              onBlur={() =>
                setDraft((d) => ({
                  ...d,
                  vendor: { ...d.vendor, cuit: fmtCuit(d.vendor.cuit) },
                }))
              }
            />
            {draft.vendor.cuit && (
              <span
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${
                  cuitOk ? "text-status-success" : "text-tops-red"
                }`}
              >
                <Icon name={cuitOk ? "check-circle" : "x"} size={16} stroke={2} />
              </span>
            )}
          </div>
        </Field>

        <Field label="Domicilio" cs={2}>
          <input
            className="input"
            value={draft.vendor.domicilio}
            onChange={(e) =>
              setDraft((d) => ({ ...d, vendor: { ...d.vendor, domicilio: e.target.value } }))
            }
          />
        </Field>
        <Field label="Teléfono">
          <input
            className="input"
            value={draft.vendor.telefono}
            onChange={(e) =>
              setDraft((d) => ({ ...d, vendor: { ...d.vendor, telefono: e.target.value } }))
            }
          />
        </Field>

        <Field label="Contacto" cs={1}>
          <input
            className="input"
            value={draft.vendor.contacto}
            onChange={(e) =>
              setDraft((d) => ({ ...d, vendor: { ...d.vendor, contacto: e.target.value } }))
            }
          />
        </Field>
        <Field label="Email" required cs={2} help="Recibirá el PDF firmado automáticamente">
          <div className="relative">
            <Icon
              name="mail"
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
            />
            <input
              type="email"
              className="input pl-9"
              placeholder="ventas@proveedor.com"
              value={draft.vendor.email}
              onChange={(e) =>
                setDraft((d) => ({ ...d, vendor: { ...d.vendor, email: e.target.value } }))
              }
            />
          </div>
        </Field>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  cs,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  cs?: number;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={cs ? { gridColumn: `span ${cs}` } : undefined}>
      <label className="field-label block mb-1.5">
        {label}
        {required && <span className="req">*</span>}
      </label>
      {children}
      {help && <div className="text-[11px] text-fg-muted mt-1">{help}</div>}
    </div>
  );
}

// =========================== STEP 2 — General ===========================

function GeneralStep({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: (next: Draft | ((d: Draft) => Draft)) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <div className="field-label mb-2">Destino del despacho</div>
        <div className="grid sm:grid-cols-2 gap-3">
          {ORG.depots.map((d) => {
            const selected = draft.depot === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    depot: d.id as Depot,
                    destino: `Depósito ${d.label} · CABA`,
                  }))
                }
                className={[
                  "relative text-left p-4 rounded-lg border transition-all",
                  selected
                    ? "bg-tops-blue-900 text-white border-tops-blue-900"
                    : "bg-white border-stroke-soft hover:border-tops-blue-700",
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`text-[10px] font-bold uppercase tracking-[0.16em] ${selected ? "text-white/70" : "text-tops-red"}`}>
                      Depósito {d.tag}
                    </div>
                    <div className={`text-lg font-bold ${selected ? "text-white" : "text-fg-brand"}`}>
                      {d.label}
                    </div>
                    <div className={`text-xs mt-1 ${selected ? "text-white/70" : "text-fg-secondary"}`}>
                      {d.address}
                    </div>
                  </div>
                  {selected && (
                    <Icon name="check-circle" size={20} className="text-white" stroke={2.2} />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Condición de pago" required>
          <div className="relative">
            <select
              className="input appearance-none pr-8"
              value={draft.cond_pago}
              onChange={(e) => setDraft((d) => ({ ...d, cond_pago: e.target.value }))}
            >
              {COND_PAGO_OPTIONS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <Icon
              name="chevron-down"
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none"
            />
          </div>
        </Field>
        <Field label="Entrega" required>
          <div className="relative">
            <Icon
              name="calendar"
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
            />
            <input
              className="input pl-9"
              value={draft.entrega}
              onChange={(e) => setDraft((d) => ({ ...d, entrega: e.target.value }))}
              placeholder="Inmediata, 7 días, fecha…"
            />
          </div>
        </Field>
      </div>

      <div>
        <div className="field-label mb-2">Categoría contable</div>
        <div className="flex flex-wrap gap-2">
          {POSITIVE_CATEGORIES.map((c) => {
            const sel = draft.categoria === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, categoria: c }))}
                className={[
                  "px-3 py-2 rounded-pill border text-xs font-bold transition-all inline-flex items-center gap-1.5",
                  sel
                    ? "bg-tops-blue-900 text-white border-tops-blue-900"
                    : "bg-white border-stroke-soft hover:border-tops-blue-700",
                ].join(" ")}
              >
                {sel && <Icon name="check" size={12} stroke={2.4} />}
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {/* Emisor card */}
      <div
        className="rounded-lg p-4 flex items-center gap-3 border border-stroke-soft"
        style={{
          background:
            "linear-gradient(135deg, rgba(201,8,18,0.06), rgba(5,5,85,0.05))",
        }}
      >
        <div className="w-12 h-12 rounded-full bg-tops-red text-white grid place-items-center font-bold">
          {ORG.emitter.initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-fg-brand">{ORG.emitter.name}</div>
          <div className="text-xs text-fg-secondary">{ORG.emitter.role}</div>
        </div>
        <span className="badge badge-success">
          <span className="dot" />
          Autorizado
        </span>
      </div>
    </div>
  );
}

// =========================== STEP 3 — Products ===========================

function ProductsStep({
  products,
  draft,
  setDraft,
  totals,
}: {
  products: Product[];
  draft: Draft;
  setDraft: (next: Draft | ((d: Draft) => Draft)) => void;
  totals: { neto: number; iva: number; total: number };
}) {
  const [pickerForIdx, setPickerForIdx] = useState<number | null>(null);

  const updateItem = (i: number, patch: Partial<POItem>) => {
    setDraft((d) => {
      const items = d.items.map((it, idx) => {
        if (idx !== i) return it;
        const next = { ...it, ...patch };
        next.subtotal = lineSubtotal(next.qty, next.price);
        return next;
      });
      return { ...d, items };
    });
  };

  const removeItem = (i: number) => {
    setDraft((d) => ({
      ...d,
      items: d.items.length === 1 ? [EMPTY_ITEM(0)] : d.items.filter((_, idx) => idx !== i),
    }));
  };

  const addItem = () =>
    setDraft((d) => ({ ...d, items: [...d.items, EMPTY_ITEM(d.items.length)] }));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto -mx-5 md:mx-0">
        <table className="lines-table w-full min-w-[640px]">
          <thead>
            <tr>
              <th className="text-left text-[10px] font-bold uppercase tracking-wide text-fg-muted px-2 py-2 w-10">
                N°
              </th>
              <th className="text-left text-[10px] font-bold uppercase tracking-wide text-fg-muted px-2 py-2">
                Producto / Servicio
              </th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-fg-muted px-2 py-2 w-16">
                Cant.
              </th>
              <th className="text-left text-[10px] font-bold uppercase tracking-wide text-fg-muted px-2 py-2 w-20">
                Un.
              </th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-fg-muted px-2 py-2 w-28">
                Precio unit.
              </th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-fg-muted px-2 py-2 w-32">
                Subtotal
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {draft.items.map((it, i) => (
              <tr key={i} className="border-b border-stroke-soft">
                <td className="px-2 py-1 text-center font-mono text-fg-muted text-[11px]">
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td className="px-1 py-1 relative">
                  <input
                    className="w-full px-2 py-2 rounded-md border border-transparent hover:bg-white hover:border-stroke-soft focus:bg-white focus:border-tops-blue-700 focus:outline-none focus:ring-2 focus:ring-tops-blue-700/20 text-sm font-semibold text-fg-primary"
                    placeholder="Tipeá o seleccioná del catálogo"
                    value={it.label}
                    onFocus={() => setPickerForIdx(i)}
                    onChange={(e) => updateItem(i, { label: e.target.value, sku: null })}
                  />
                  {pickerForIdx === i && (
                    <ProductPicker
                      products={products}
                      query={it.label}
                      onPick={(p) => {
                        updateItem(i, {
                          sku: p.sku,
                          label: p.label,
                          unit: p.unit,
                          price: p.price,
                          qty: it.qty || 1,
                        });
                        setPickerForIdx(null);
                      }}
                      onClose={() => setPickerForIdx(null)}
                    />
                  )}
                </td>
                <td className="px-1 py-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    className="w-full px-2 py-2 rounded-md border border-transparent hover:bg-white hover:border-stroke-soft focus:bg-white focus:border-tops-blue-700 focus:outline-none focus:ring-2 focus:ring-tops-blue-700/20 text-sm text-right tabular"
                    value={it.qty || ""}
                    onChange={(e) => updateItem(i, { qty: Number(e.target.value) || 0 })}
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    className="w-full px-2 py-2 rounded-md border border-transparent hover:bg-white hover:border-stroke-soft focus:bg-white focus:border-tops-blue-700 focus:outline-none focus:ring-2 focus:ring-tops-blue-700/20 text-sm text-fg-secondary"
                    value={it.unit}
                    onChange={(e) => updateItem(i, { unit: e.target.value })}
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.01}
                    className="w-full px-2 py-2 rounded-md border border-transparent hover:bg-white hover:border-stroke-soft focus:bg-white focus:border-tops-blue-700 focus:outline-none focus:ring-2 focus:ring-tops-blue-700/20 text-sm text-right tabular"
                    value={it.price || ""}
                    onChange={(e) => updateItem(i, { price: Number(e.target.value) || 0 })}
                  />
                </td>
                <td className="px-2 py-2 text-right tabular font-bold text-fg-brand">
                  {fmtCurrency(it.subtotal)}
                </td>
                <td className="px-1 py-1">
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="w-7 h-7 rounded-md grid place-items-center text-fg-muted hover:bg-tops-red/10 hover:text-tops-red transition-colors"
                    aria-label="Quitar línea"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-2">
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-stroke-strong bg-neutral-50 text-xs font-bold uppercase tracking-wide text-fg-brand hover:border-tops-blue-700 hover:bg-tops-blue-700/10 transition-colors"
        >
          <Icon name="plus" size={12} stroke={2.4} />
          Agregar producto
        </button>
      </div>

      {/* Totales */}
      <div className="rounded-lg bg-neutral-50 border-t border-stroke-soft p-4 mt-2">
        <div className="flex justify-between text-sm text-fg-secondary py-1">
          <span>Subtotal neto</span>
          <b className="text-fg-primary tabular">{fmtCurrency(totals.neto)}</b>
        </div>
        <div className="flex justify-between text-sm text-fg-secondary py-1">
          <span>IVA 21%</span>
          <b className="text-fg-primary tabular">{fmtCurrency(totals.iva)}</b>
        </div>
        <div className="flex justify-between pt-2 mt-1 border-t border-stroke-soft text-base font-bold text-fg-brand">
          <span>TOTAL</span>
          <b className="tabular text-lg">{fmtCurrency(totals.total)}</b>
        </div>
      </div>

      <Field label="Observaciones para el proveedor">
        <textarea
          rows={3}
          className="textarea"
          placeholder="Coordinación de entrega, certificados requeridos, ANMAT, etc."
          value={draft.observ}
          onChange={(e) => setDraft((d) => ({ ...d, observ: e.target.value }))}
        />
      </Field>

      {/* Smart suggestion */}
      <SmartSuggestion draft={draft} setDraft={setDraft} products={products} />
    </div>
  );
}

function ProductPicker({
  products,
  query,
  onPick,
  onClose,
}: {
  products: Product[];
  query: string;
  onPick: (p: Product) => void;
  onClose: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);
  const lo = query.toLowerCase();
  const matches = products
    .filter((p) => !lo || p.label.toLowerCase().includes(lo) || p.sku.toLowerCase().includes(lo))
    .slice(0, 10);
  if (matches.length === 0) return null;
  return (
    <div
      ref={wrap}
      className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-stroke-soft rounded-md shadow-md max-h-80 overflow-y-auto"
    >
      {matches.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p)}
          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 text-left"
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-fg-primary truncate">{p.label}</div>
            <div className="text-[11px] font-mono text-fg-muted">{p.sku}</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold text-fg-brand tabular">{fmtCurrency(p.price)}</div>
            <div className="text-[10px] text-fg-muted">/ {p.unit}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function SmartSuggestion({
  draft,
  setDraft,
  products,
}: {
  draft: Draft;
  setDraft: (next: Draft | ((d: Draft) => Draft)) => void;
  products: Product[];
}) {
  // Si el draft incluye pallets sin cinta adhesiva, sugerir cinta adhesiva
  const hasPallets = draft.items.some(
    (it) => (it.sku ?? "").startsWith("PAL-") || it.label.toLowerCase().includes("pallet")
  );
  const hasTape = draft.items.some(
    (it) => (it.sku ?? "").startsWith("CIN-") || it.label.toLowerCase().includes("cinta")
  );
  if (!hasPallets || hasTape) return null;

  const tape = products.find((p) => p.sku === "CIN-ADH-48");
  if (!tape) return null;

  const add = () =>
    setDraft((d) => ({
      ...d,
      items: [
        ...d.items.filter((it) => it.label),
        {
          sku: tape.sku,
          label: tape.label,
          unit: tape.unit,
          qty: 24,
          price: tape.price,
          subtotal: lineSubtotal(24, tape.price),
          pos: d.items.length,
        },
      ],
    }));

  return (
    <div
      className="rounded-lg p-3 flex items-center gap-3 border border-stroke-soft"
      style={{
        background:
          "linear-gradient(135deg, rgba(33,69,118,0.06), rgba(201,8,18,0.04))",
      }}
    >
      <div className="w-9 h-9 rounded-md bg-tops-blue-700/10 text-tops-blue-700 grid place-items-center">
        <Icon name="wand" size={16} />
      </div>
      <div className="flex-1 text-xs text-fg-primary">
        Pallets Sur suele entregar cinta adhesiva junto con pallets. ¿Sumar 24 un. de{" "}
        <span className="font-bold">{tape.label}</span>?
      </div>
      <button type="button" onClick={add} className="btn btn-ghost btn-sm">
        Agregar
      </button>
    </div>
  );
}

// =========================== STEP 4 — Signature ===========================

function SignatureStep({
  draft,
  setDraft,
  totals,
  onSubmit,
  saving,
  error,
}: {
  draft: Draft;
  setDraft: (next: Draft | ((d: Draft) => Draft)) => void;
  totals: { neto: number; iva: number; total: number };
  onSubmit: () => void;
  saving: boolean;
  error: string | null;
}) {
  const padRef = useRef<SignaturePadHandle>(null);

  const onInkChange = async (hasInk: boolean) => {
    if (!hasInk) {
      setDraft((d) => ({ ...d, signed: false, signatureDataUrl: null, signatureHash: null }));
      return;
    }
    const dataUrl = padRef.current?.toDataURL() ?? null;
    const hash = (await padRef.current?.toHash()) ?? null;
    setDraft((d) => ({ ...d, signed: true, signatureDataUrl: dataUrl, signatureHash: hash }));
  };

  return (
    <div className="space-y-5">
      {/* Emisor */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-neutral-50 border border-stroke-soft">
        <div className="w-12 h-12 rounded-full bg-tops-red text-white grid place-items-center font-bold flex-shrink-0">
          {ORG.emitter.initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-fg-brand">{ORG.emitter.name}</div>
          <div className="text-xs text-fg-secondary">
            {ORG.emitter.role} · {ORG.emitter.email}
          </div>
        </div>
        <span className="text-xs text-fg-muted tabular">Total: {fmtCurrency(totals.total)}</span>
      </div>

      <SignaturePad ref={padRef} onChange={onInkChange} />

      <div className="flex items-center justify-between text-xs text-fg-secondary">
        <button
          type="button"
          onClick={() => padRef.current?.clear()}
          className="btn btn-ghost btn-sm"
        >
          <Icon name="refresh" size={12} />
          Limpiar firma
        </button>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="shield" size={12} />
          Hash SHA-256 generado al guardar
        </span>
      </div>

      <div className="rounded-lg border border-stroke-soft p-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-secondary mb-3">
          Al confirmar se ejecutan automáticamente
        </div>
        <ul className="space-y-2 text-sm">
          {[
            { icon: "file-pdf" as const, label: "Generar PDF corporativo con QR y firma" },
            { icon: "drive" as const, label: `Subir a Drive: /${ORG.driveRoot}/Mayo/${draft.vendor.razon || "Proveedor"}` },
            { icon: "mail" as const, label: `Enviar email a ${draft.vendor.email || "—"}, ${ORG.admin.email} y ${ORG.emitter.email}` },
            { icon: "database" as const, label: "Registrar en historial y trazabilidad" },
          ].map((row, i) => (
            <li key={i} className="flex items-center gap-2.5">
              <span className="w-5 h-5 rounded-full bg-status-success/15 text-status-success grid place-items-center">
                <Icon name="check" size={12} stroke={2.4} />
              </span>
              <Icon name={row.icon} size={14} className="text-fg-muted" />
              <span className="text-fg-primary">{row.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <div className="rounded-md border border-tops-red/30 bg-tops-red/5 text-tops-red text-sm px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!draft.signed || saving}
        className="btn btn-danger btn-lg w-full"
      >
        {saving ? (
          <>
            <Icon name="refresh" size={16} className="animate-spin" />
            Procesando…
          </>
        ) : (
          <>
            <Icon name="send" size={16} stroke={2} />
            Confirmar, firmar y enviar
          </>
        )}
      </button>
    </div>
  );
}
