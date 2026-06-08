"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";
import { createVendor } from "@/app/(app)/compras/proveedores/actions";

type Form = { razon: string; cuit: string; contacto: string; email: string; telefono: string; domicilio: string; categoria: string; cond_pago: string };
const EMPTY: Form = { razon: "", cuit: "", contacto: "", email: "", telefono: "", domicilio: "", categoria: "", cond_pago: "30 días" };

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-fg-secondary">{label}{required && <span className="text-tops-red"> *</span>}</span>
      {children}
    </label>
  );
}

export function NuevoProveedorButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
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
