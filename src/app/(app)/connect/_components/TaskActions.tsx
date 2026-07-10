"use client";

// Nexus Link · acciones de ciclo de vida de la tarea (F4.3). La UI ofrece solo
// lo que el dominio habilita (availableTaskActions, espejo de 0169); el RPC
// re-valida SIEMPRE. Claim solo de vacantes; cancelar exige motivo breve.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { VoiceField } from "@/components/voice/VoiceField";
import {
  assignTaskAction, ensureTaskThreadAction, followTaskAction,
  setTaskDueAction, setTaskPriorityAction, setTaskStatusAction,
} from "@/lib/connect/adapters/driving/task-actions";
import { searchProfilesAction, type ProfileHit } from "@/lib/connect/adapters/driving/channel-actions";
import {
  availableTaskActions, type TaskAction, type TaskViewer,
} from "@/lib/connect/domain/task";
import {
  TASK_PRIORITIES, TASK_PRIORITY_LABELS, type Task, type TaskPriority,
} from "@/lib/connect/types";

export function TaskActions({
  task, currentUserId, isTaskAdmin, isFollower, hasThread,
}: {
  task: Task;
  currentUserId: string | null;
  isTaskAdmin: boolean;
  isFollower: boolean;
  hasThread: boolean;
}) {
  const router = useRouter();
  const viewer: TaskViewer = { userId: currentUserId, isTaskAdmin, isFollower };
  const actions = availableTaskActions(task, viewer);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [addingFollower, setAddingFollower] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProfileHit[]>([]);
  // Fix M-6 adversarial: precargar la fecha existente en formato datetime-local
  // (hora local del navegador, no UTC).
  const [due, setDue] = useState(() => {
    if (!task.dueAt) return "";
    const d = new Date(task.dueAt);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [editingDue, setEditingDue] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) {
        setError(("message" in r && r.message) || "No se pudo completar la acción.");
        return;
      }
      setAssigning(false);
      setCanceling(false);
      setAddingFollower(false);
      setEditingDue(false);
      setMotivo("");
      router.refresh();
    } catch {
      setError("No se pudo completar la acción. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  async function search(q: string, excludeAssignee: boolean) {
    setQuery(q);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const r = await searchProfilesAction({ q });
    setHits(r.ok ? r.hits.filter((h) => !excludeAssignee || h.profileId !== task.asignadoA) : []);
  }

  const has = (a: TaskAction) => actions.includes(a);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {has("claim") && currentUserId && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy}
            onClick={() => void run(() => assignTaskAction({ taskId: task.id, toProfileId: currentUserId }))}>
            <Icon name="user" size={13} /> Reclamar
          </button>
        )}
        {has("assign") && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => { setAssigning((s) => !s); setCanceling(false); setAddingFollower(false); }}>
            <Icon name="users" size={13} /> Asignar a…
          </button>
        )}
        {has("return") && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => void run(() => assignTaskAction({ taskId: task.id, toProfileId: null }))}>
            <Icon name="arrow-left" size={13} /> Devolver
          </button>
        )}
        {has("start") && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => void run(() => setTaskStatusAction({ taskId: task.id, status: "en_progreso" }))}>
            <Icon name="play" size={13} /> Iniciar
          </button>
        )}
        {has("complete") && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy}
            onClick={() => void run(() => setTaskStatusAction({ taskId: task.id, status: "completada" }))}>
            <Icon name="check-circle" size={13} /> Completar
          </button>
        )}
        {has("reopen") && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => void run(() => setTaskStatusAction({ taskId: task.id, status: "en_progreso" }))}>
            <Icon name="refresh" size={13} /> Reabrir
          </button>
        )}
        {has("cancel") && (
          <button type="button" className="btn btn-danger btn-sm" disabled={busy}
            onClick={() => { setCanceling((s) => !s); setAssigning(false); setAddingFollower(false); }}>
            <Icon name="x" size={13} /> Cancelar tarea
          </button>
        )}
        {has("set_priority") && (
          <label className="flex items-center gap-1 text-[11px] text-fg-muted">
            Prioridad
            <select className="input text-xs" value={task.prioridad} disabled={busy}
              onChange={(e) =>
                void run(() => setTaskPriorityAction({
                  taskId: task.id, priority: e.target.value as TaskPriority,
                }))}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </label>
        )}
        {has("set_due") && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => setEditingDue((s) => !s)}>
            <Icon name="calendar" size={13} /> Fecha límite
          </button>
        )}
        {has("follow") && currentUserId && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => void run(() => followTaskAction({ taskId: task.id, userId: currentUserId, follow: !isFollower }))}>
            <Icon name="star" size={13} /> {isFollower ? "Dejar de seguir" : "Seguir"}
          </button>
        )}
        {has("add_follower") && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => { setAddingFollower((s) => !s); setAssigning(false); setCanceling(false); }}>
            <Icon name="plus" size={13} /> Agregar seguidor
          </button>
        )}
        {!hasThread && task.estado !== "completada" && task.estado !== "cancelada" && (
          // Fix I-3 adversarial: en estados terminales no se ofrece crear un
          // hilo que nacería read-only (el RPC también lo rechaza).
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => void run(() => ensureTaskThreadAction({ taskId: task.id }))}>
            <Icon name="chat" size={13} /> Iniciar conversación
          </button>
        )}
      </div>

      {(assigning || addingFollower) && (
        <div className="card space-y-2 p-3">
          <input className="input" value={query}
            placeholder="Buscar usuario interno (mín. 2 letras)…"
            onChange={(e) => void search(e.target.value, assigning)} />
          {hits.length > 0 && (
            <ul className="space-y-1">
              {hits.map((h) => (
                <li key={h.profileId}>
                  <button type="button" className="btn btn-ghost btn-sm w-full justify-start" disabled={busy}
                    onClick={() =>
                      void run(() => assigning
                        ? assignTaskAction({ taskId: task.id, toProfileId: h.profileId })
                        : followTaskAction({ taskId: task.id, userId: h.profileId, follow: true }))}>
                    <Icon name="user" size={13} /> {h.fullName ?? "Usuario interno"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canceling && (
        <div className="card space-y-2 p-3">
          {task.workflowInstanceId && (
            <p className="text-[11px] text-amber-500">
              Esta tarea es el paso {task.stepNo} de un workflow: cancelarla detiene la cadena.
            </p>
          )}
          <VoiceField>
            <textarea className="input min-h-16 w-full" value={motivo} maxLength={300}
              placeholder="Motivo breve de la cancelación (obligatorio)…"
              onChange={(e) => setMotivo(e.target.value)} />
          </VoiceField>
          <button type="button" className="btn btn-danger btn-sm"
            disabled={busy || motivo.trim().length === 0}
            onClick={() => void run(() => setTaskStatusAction({ taskId: task.id, status: "cancelada", motivo }))}>
            <Icon name="x" size={13} /> Confirmar cancelación
          </button>
        </div>
      )}

      {editingDue && (
        <div className="card flex flex-wrap items-end gap-2 p-3">
          <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
            Nueva fecha límite (informativa)
            <input type="datetime-local" className="input" value={due}
              onChange={(e) => setDue(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !due}
            onClick={() => void run(() => setTaskDueAction({ taskId: task.id, dueAt: new Date(due).toISOString() }))}>
            Guardar
          </button>
          {task.dueAt && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => void run(() => setTaskDueAction({ taskId: task.id, dueAt: null }))}>
              Quitar fecha
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
