"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";
import { createVendor } from "@/app/(app)/compras/proveedores/actions";
import { AccountPicker } from "@/components/erp/AccountPicker";
import {
  COND_IVA_VENDOR_OPTIONS,
  VENDOR_CONCEPTO_GANANCIAS_LABEL,
  type VendorConceptoGanancias,
} from "@/lib/types-po";
import type { ChartAccount } from "@/lib/erp/types";

type Form = {
  razon: string; cuit: string; contacto: string; email: string; telefono: string;
  domicilio: string; categoria: string; cond_pago: string;
  cond_iva: string; concepto_ganancias: string; cuenta_contable: string;
};
const EMPTY: Form = {
  razon: "", cuit: "", contacto: "", email: "", telefono: "", domicilio: "",
  categoria: "", cond_pago: "30 días", cond_iva: "", concepto_ganancias: "", cuenta_contable: "",
};

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-fg-secondary">{label}{required && <span className="text-tops-red"> *</span>}</span>
      {children}
    </label>
  );
}

export function NuevoProveedorButton({ accounts = [] }: { accounts?: ChartAccount[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const setVal = (k: keyof Form, v: string) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.razon.trim().length >= 2 && f.cuit.replace(/\D/g, "").length === 11;

  function submit() {
    setError(null);
    start(async () => {
      const r = await createVendor(f);
      if (r.ok) { setOpen(false); setF(EMPTY); router.refresh(); }
      else setError(r.error);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
        <Icon name="plus" size={14} stroke={2.2} /> <span>Nuevo proveedor</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm grid place-items-center p-4" onClick={() => !pending && setOpen(false)}>
          <div className="w-full max-w-lg bg-bg-surface rounded-lg border border-stroke-soft shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between">
              <h2 className="font-bold text-fg-primary">Nuevo proveedor</h2>
              <button onClick={() => setOpen(false)} className="text-fg-muted hover:text-fg-primary" aria-label="Cerrar"><Icon name="x" size={16} /></button>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
              <div className="sm:col-span-2"><Field label="Razón social" required><input className="input" value={f.razon} onChange={set("razon")} placeholder="Proveedor S.A." /></Field></div>
              <Field label="CUIT" required><input className="input" value={f.cuit} onChange={set("cuit")} placeholder="30-12345678-9" /></Field>
              <Field label="Categoría"><input className="input" value={f.categoria} onChange={set("categoria")} /></Field>
              <Field label="Contacto"><input className="input" value={f.contacto} onChange={set("contacto")} /></Field>
              <Field label="Email"><input type="email" className="input" value={f.email} onChange={set("email")} /></Field>
              <Field label="Teléfono"><input className="input" value={f.telefono} onChange={set("telefono")} /></Field>
              <Field label="Cond. de pago"><input className="input" value={f.cond_pago} onChange={set("cond_pago")} /></Field>
              <div className="sm:col-span-2"><Field label="Domicilio"><input className="input" value={f.domicilio} onChange={set("domicilio")} /></Field></div>

              {/* ── Datos fiscales / contables (Contadora) ─────────── */}
              <div className="sm:col-span-2 mt-1 pt-2 border-t border-stroke-soft">
                <div className="text-[11px] font-bold uppercase tracking-wide text-fg-muted">Fiscal & contable</div>
              </div>
              <Field label="Categoría fiscal (IVA)">
                <select className="input" value={f.cond_iva} onChange={set("cond_iva")}>
                  <option value="">Sin definir</option>
                  {COND_IVA_VENDOR_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Concepto Ganancias">
                <select className="input" value={f.concepto_ganancias} onChange={set("concepto_ganancias")}>
                  <option value="">Sin definir</option>
                  {(Object.keys(VENDOR_CONCEPTO_GANANCIAS_LABEL) as VendorConceptoGanancias[]).map((k) =>
                    <option key={k} value={k}>{VENDOR_CONCEPTO_GANANCIAS_LABEL[k]}</option>)}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Cuenta contable (Plan de Cuentas)">
                  <AccountPicker accounts={accounts} value={f.cuenta_contable} onChange={(c) => setVal("cuenta_contable", c)} placeholder="Sin imputar" />
                </Field>
              </div>
            </div>
            {error && <div className="mx-4 mb-2 rounded-md bg-tops-red/10 text-tops-red text-sm px-3 py-2 border border-tops-red/20">{error}</div>}
            <div className="px-4 py-3 border-t border-stroke-soft flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn btn-ghost btn-sm" disabled={pending}>Cancelar</button>
              <button onClick={submit} disabled={!valid || pending} className="btn btn-primary btn-sm disabled:opacity-50">
                <Icon name="check" size={14} /> {pending ? "Guardando…" : "Crear proveedor"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
