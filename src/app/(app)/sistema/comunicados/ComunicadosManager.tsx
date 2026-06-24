"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import {
  COMUNICADO_ICONS,
  COMUNICADO_PRIORITIES,
  PRIORITY_LABEL,
  type AnnouncementRow,
  type ComunicadoIcon,
  type ComunicadoPriority,
} from "@/lib/comunicados/types";
import {
  createAnnouncementAction,
  updateAnnouncementAction,
  setAnnouncementActiveAction,
  deleteAnnouncementAction,
} from "./actions";

interface FormState {
  id: string | null;
  title: string;
  description: string;
  icon: ComunicadoIcon;
  priority: ComunicadoPriority;
  active: boolean;
  sort_order: number;
}

const EMPTY: FormState = {
  id: null,
  title: "",
  description: "",
  icon: "megaphone",
  priority: "medium",
  active: true,
  sort_order: 0,
};

export function ComunicadosManager({ rows }: { rows: AnnouncementRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const editing = form.id !== null;

  function submit() {
    setError(null);
    const input = {
      title: form.title,
      description: form.description,
      icon: form.icon,
      priority: form.priority,
      active: form.active,
      sort_order: Number(form.sort_order) || 0,
    };
    startTransition(async () => {
      const res = editing
        ? await updateAnnouncementAction(form.id as string, input)
        : await createAnnouncementAction(input);
      if (res.ok) {
        setForm(EMPTY);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function edit(r: AnnouncementRow) {
    setError(null);
    setForm({
      id: r.id,
      title: r.title,
      description: r.description,
      icon: r.icon,
      priority: r.priority,
      active: r.active,
      sort_order: r.sort_order,
    });
  }

  function toggle(r: AnnouncementRow) {
    setError(null);
    startTransition(async () => {
      const res = await setAnnouncementActiveAction(r.id, !r.active);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  function remove(r: AnnouncementRow) {
    if (!window.confirm(`¿Borrar el comunicado “${r.title}”?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAnnouncementAction(r.id);
      if (res.ok) {
        if (form.id === r.id) setForm(EMPTY);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{editing ? "Editar comunicado" : "Nuevo comunicado"}</h2>
          {editing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setForm(EMPTY); setError(null); }}>
              Cancelar edición
            </button>
          )}
        </div>
        {error && (
          <div className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
            {error}
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="field-label block mb-1.5">Título *</label>
            <input className="input" value={form.title} maxLength={60} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="¡Atención!" required />
          </div>
          <div>
            <label className="field-label block mb-1.5">Descripción</label>
            <input className="input" value={form.description} maxLength={160} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Actualización urgente del sistema" />
          </div>
          <div>
            <label className="field-label block mb-1.5">Ícono</label>
            <select className="input" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value as ComunicadoIcon })}>
              {COMUNICADO_ICONS.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label block mb-1.5">Prioridad</label>
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as ComunicadoPriority })}>
              {COMUNICADO_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label block mb-1.5">Orden</label>
            <input type="number" className="input" value={form.sort_order} min={0} max={99} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
          </div>
          <label className="flex items-center gap-2 mt-6 select-none">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            <span className="text-sm">Activo (visible en el cockpit)</span>
          </label>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={pending || !form.title.trim()}>
            {pending ? (
              <><Icon name="refresh" size={14} className="animate-spin" /> Guardando…</>
            ) : (
              <><Icon name={editing ? "check" : "plus"} size={14} stroke={2.2} /> {editing ? "Guardar cambios" : "Crear comunicado"}</>
            )}
          </button>
        </div>
      </form>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft">
          <h2 className="text-sm font-semibold">Comunicados</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Prioridad</th>
                <th>Título</th>
                <th>Descripción</th>
                <th>Orden</th>
                <th>Estado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? "" : "opacity-55"}>
                  <td className="text-xs font-semibold uppercase">{r.priority}</td>
                  <td className="text-sm font-semibold text-fg-primary">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name={r.icon} size={14} />
                      {r.title}
                    </span>
                  </td>
                  <td className="text-sm text-fg-muted">{r.description}</td>
                  <td className="text-sm tabular">{r.sort_order}</td>
                  <td>{r.active ? "Activo" : "Inactivo"}</td>
                  <td className="text-right whitespace-nowrap">
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => edit(r)}>Editar</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => toggle(r)}>{r.active ? "Desactivar" : "Reactivar"}</button>
                    <button type="button" className="btn btn-ghost btn-sm text-status-danger" disabled={pending} onClick={() => remove(r)}>Borrar</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-fg-muted py-8 text-sm">Aún no hay comunicados. Creá el primero arriba.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
