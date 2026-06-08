"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { crearEmpleado } from "@/lib/rrhh/actions";

type Form = Record<string, string>;
const EMPTY: Form = {
  apellido_nombre: "", dni: "", cuil: "", fecha_nacimiento: "", domicilio: "", telefono: "",
  email_personal: "", estado_civil: "", fecha_ingreso: "", fecha_reconocida: "", categoria: "",
  seccion: "", convenio: "", modalidad_contratacion: "", depot: "", obra_social: "",
};

const ESTADO_CIVIL = ["soltero", "casado", "divorciado", "viudo", "union_convivencial", "otro"];
const MODALIDAD = ["tiempo_indeterminado", "plazo_fijo", "eventual", "temporada", "pasantia", "otro"];

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-fg-secondary">
        {label}{required && <span className="text-tops-red"> *</span>}
      </span>
      {children}
    </label>
  );
}

export function EmpleadoForm() {
  const router = useRouter();
  const [f, setF] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const valid = f.apellido_nombre.trim().length >= 2 && f.dni.trim().length >= 6 && f.cuil.trim().length >= 8 && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha_ingreso);

  function submit() {
    setError(null);
    start(async () => {
      const r = await crearEmpleado(f);
      if (r.ok) router.push("/rrhh/empleados");
      else setError(r.message);
    });
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="user" size={15} /> Datos personales</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Apellido y nombre" required><input className="input" value={f.apellido_nombre} onChange={set("apellido_nombre")} placeholder="Pérez, Juan" /></Field>
          <Field label="Estado civil"><select className="input" value={f.estado_civil} onChange={set("estado_civil")}><option value="">—</option>{ESTADO_CIVIL.map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select></Field>
          <Field label="DNI" required><input className="input" value={f.dni} onChange={set("dni")} placeholder="30123456" /></Field>
          <Field label="CUIL" required><input className="input" value={f.cuil} onChange={set("cuil")} placeholder="20-30123456-3" /></Field>
          <Field label="Fecha de nacimiento"><input type="date" className="input" value={f.fecha_nacimiento} onChange={set("fecha_nacimiento")} /></Field>
          <Field label="Teléfono"><input className="input" value={f.telefono} onChange={set("telefono")} /></Field>
          <Field label="Email personal"><input type="email" className="input" value={f.email_personal} onChange={set("email_personal")} /></Field>
          <Field label="Domicilio"><input className="input" value={f.domicilio} onChange={set("domicilio")} /></Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="building" size={15} /> Datos laborales</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Fecha de ingreso" required><input type="date" className="input" value={f.fecha_ingreso} onChange={set("fecha_ingreso")} /></Field>
          <Field label="Antigüedad reconocida (si difiere)"><input type="date" className="input" value={f.fecha_reconocida} onChange={set("fecha_reconocida")} /></Field>
          <Field label="Categoría"><input className="input" value={f.categoria} onChange={set("categoria")} /></Field>
          <Field label="Sección"><input className="input" value={f.seccion} onChange={set("seccion")} /></Field>
          <Field label="Convenio"><input className="input" value={f.convenio} onChange={set("convenio")} /></Field>
          <Field label="Modalidad de contratación"><select className="input" value={f.modalidad_contratacion} onChange={set("modalidad_contratacion")}><option value="">—</option>{MODALIDAD.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}</select></Field>
          <Field label="Depósito"><select className="input" value={f.depot} onChange={set("depot")}><option value="">—</option><option value="MAGALDI">Magaldi</option><option value="LUJAN">Luján</option></select></Field>
          <Field label="Obra social"><input className="input" value={f.obra_social} onChange={set("obra_social")} /></Field>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-md bg-tops-red/10 text-tops-red text-sm px-3 py-2 border border-tops-red/20 flex items-start gap-2">
          <Icon name="x" size={14} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={submit} disabled={!valid || pending} className="btn btn-primary btn-sm disabled:opacity-50">
          <Icon name="check" size={14} /> {pending ? "Guardando…" : "Dar de alta"}
        </button>
        <Link href="/rrhh/empleados" className="btn btn-ghost btn-sm">Cancelar</Link>
      </div>
      <p className="text-[11px] text-fg-muted">El nº de legajo se asigna automáticamente. DNI y CUIL deben ser únicos.</p>
    </div>
  );
}
