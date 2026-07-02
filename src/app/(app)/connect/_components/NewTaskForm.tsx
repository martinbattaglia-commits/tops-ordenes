"use client";

// Nexus Link · formulario de alta de tarea (F4.3). Puede nacer vacante
// (reclamable) o asignada; opcionalmente vinculada a un incidente (prefill).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { createTaskAction } from "@/lib/connect/adapters/driving/task-actions";
import { searchProfilesAction, type ProfileHit } from "@/lib/connect/adapters/driving/channel-actions";
import {
  TASK_PRIORITIES, TASK_PRIORITY_LABELS, type TaskPriority,
} from "@/lib/connect/types";
import { MAX_TASK_TITLE } from "@/lib/connect/domain/task";

export function NewTaskForm({
  incidentId = null, incidentLabel = null,
}: {
  incidentId?: string | null;
  incidentLabel?: string | null;
}) {
  const router = useRouter();
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [prioridad, setPrioridad] = useState<TaskPriority>("media");
  const [due, setDue] = useState("");
  const [asignado, setAsignado] = useState<ProfileHit | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProfileHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const r = await searchProfilesAction({ q });
    setHits(r.ok ? r.hits : []);
  }

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await createTaskAction({
        titulo,
        descripcion: descripcion.trim() || null,
        prioridad,
        dueAt: due ? new Date(due).toISOString() : null,
        asignado: asignado?.profileId ?? null,
        incidentId,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/connect/tareas/${result.id}`);
      router.refresh();
    } catch {
      setError("No se pudo crear la tarea. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card max-w-xl space-y-3 p-4">
      {incidentId && (
        <p className="rounded-md bg-blue-400/10 px-3 py-2 text-xs text-blue-400">
          <Icon name="bolt" size={12} className="inline" /> Vinculada al incidente{" "}
          {incidentLabel ?? incidentId}
        </p>
      )}

      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        Título *
        <input className="input" value={titulo} maxLength={MAX_TASK_TITLE}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="ej. Reparar portón del dock 2" />
      </label>

      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        Descripción
        <textarea className="input min-h-20" value={descripcion} maxLength={4000}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Qué hay que hacer, contexto, criterio de terminado…" />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Prioridad
          <select className="input" value={prioridad}
            onChange={(e) => setPrioridad(e.target.value as TaskPriority)}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Fecha límite (informativa)
          <input type="datetime-local" className="input" value={due}
            onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>

      <div className="space-y-1">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Responsable (opcional — sin responsable queda vacante, reclamable)
          <input className="input" value={asignado ? (asignado.fullName ?? "Usuario interno") : query}
            placeholder="Buscar usuario interno (mín. 2 letras)…"
            onChange={(e) => { setAsignado(null); void search(e.target.value); }} />
        </label>
        {!asignado && hits.length > 0 && (
          <ul className="space-y-1">
            {hits.map((h) => (
              <li key={h.profileId}>
                <button type="button" className="btn btn-ghost btn-sm w-full justify-start"
                  onClick={() => { setAsignado(h); setHits([]); }}>
                  <Icon name="user" size={13} /> {h.fullName ?? "Usuario interno"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {asignado && (
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => { setAsignado(null); setQuery(""); }}>
            <Icon name="x" size={12} /> Quitar responsable
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm"
          disabled={busy || titulo.trim().length === 0}
          onClick={() => void submit()}>
          <Icon name="check" size={14} /> {busy ? "Creando…" : "Crear tarea"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => router.back()}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
