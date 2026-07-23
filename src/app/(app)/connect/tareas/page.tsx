// Nexus Link · Centro de Tareas (F4.3) — lista de gestión + workflows.
// Server component: filtros por GET (vista/estado/prioridad), orden urgente-
// primero + vencimiento. Gate connect.view heredado del layout /connect.

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  listTasks, listWorkflowTemplates, type TaskFilters, type TaskView,
} from "@/lib/connect/read/tasks-data";
import { isOverdue } from "@/lib/connect/domain/task";
import {
  TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS,
  type TaskPriority, type TaskStatus,
} from "@/lib/connect/types";
import { timeAgo } from "@/lib/connect/format";
import { OverdueChip, TaskPriorityChip, TaskStatusChip } from "../_components/TaskChips";
import { WorkflowsPanel } from "../_components/WorkflowsPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Tareas" };

const VIEWS: Array<{ id: TaskView; label: string }> = [
  { id: "abiertas", label: "Abiertas" },
  { id: "mias", label: "Mías" },
  { id: "creadas", label: "Creadas por mí" },
  { id: "vacantes", label: "Vacantes" },
  { id: "todas", label: "Todas" },
];

function parseFilters(sp: Record<string, string | string[] | undefined>): TaskFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const vista = one("vista");
  const estado = one("estado");
  const prioridad = one("prioridad");
  return {
    vista: VIEWS.some((v) => v.id === vista) ? (vista as TaskView) : "abiertas",
    estado: (TASK_STATUSES as readonly string[]).includes(estado ?? "")
      ? (estado as TaskStatus)
      : undefined,
    prioridad: (TASK_PRIORITIES as readonly string[]).includes(prioridad ?? "")
      ? (prioridad as TaskPriority)
      : undefined,
  };
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = parseFilters(searchParams);
  const [tasks, templates] = await Promise.all([listTasks(filters), listWorkflowTemplates()]);
  const nowIso = new Date().toISOString();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <div>
          <h1 className="text-sm font-bold text-fg-primary">Centro de Tareas</h1>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            Trabajo asignable entre personas y áreas. La fecha límite es informativa.
          </p>
        </div>
        <Link href="/connect/tareas/nueva" className="btn btn-primary btn-sm">
          <Icon name="plus" size={14} /> Nueva tarea
        </Link>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-2 border-b border-stroke-soft bg-bg-surface px-4 py-2">
        <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
          Vista
          <select name="vista" defaultValue={filters.vista} className="input text-xs">
            {VIEWS.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
          Estado
          <select name="estado" defaultValue={filters.estado ?? ""} className="input text-xs">
            <option value="">Todos</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
          Prioridad
          <select name="prioridad" defaultValue={filters.prioridad ?? ""} className="input text-xs">
            <option value="">Todas</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-ghost btn-sm text-xs">
          <Icon name="filter" size={13} /> Filtrar
        </button>
      </form>

      <div className="flex-1 space-y-4 p-4">
        {tasks.length === 0 ? (
          <EmptyState icon="check" title="Sin tareas"
            hint="No hay tareas para los filtros elegidos." />
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stroke-soft text-[10px] uppercase tracking-wide text-fg-muted">
                  <th className="px-3 py-2 font-semibold">Tarea</th>
                  <th className="px-3 py-2 font-semibold">Prioridad</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2 font-semibold">Responsable</th>
                  <th className="px-3 py-2 font-semibold">Vence</th>
                  <th className="px-3 py-2 font-semibold">Creada</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-b border-stroke-soft last:border-0 hover:bg-bg-surface-alt">
                    <td className="px-3 py-2">
                      <Link href={`/connect/tareas/${t.id}`} className="group flex min-w-0 flex-col">
                        <span className="font-mono text-[10px] text-fg-link">
                          {t.publicId}
                          {t.workflowInstanceId && ` · paso ${t.stepNo}`}
                        </span>
                        <span className="truncate font-semibold text-fg-primary group-hover:underline">
                          {t.titulo}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2"><TaskPriorityChip prioridad={t.prioridad} /></td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1">
                        <TaskStatusChip estado={t.estado} />
                        {isOverdue(t, nowIso) && <OverdueChip />}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {t.asignadoAName ?? (t.asignadoA ? "Asignada" : "Vacante")}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {t.dueAt
                        ? new Date(t.dueAt).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-fg-muted" title={t.creadoPorName ?? undefined}>
                      {timeAgo(t.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <WorkflowsPanel templates={templates} />
      </div>
    </div>
  );
}
