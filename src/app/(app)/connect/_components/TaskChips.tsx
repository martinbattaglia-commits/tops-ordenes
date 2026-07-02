// Nexus Link · chips de estado/prioridad del Centro de Tareas (F4.3).
// Server-safe. Paleta literal (tokens var() no soportan /opacity).

import {
  TASK_PRIORITY_LABELS, TASK_STATUS_LABELS,
  type TaskPriority, type TaskStatus,
} from "@/lib/connect/types";

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  urgente: "bg-red-500/15 text-red-400",
  alta: "bg-orange-400/15 text-orange-400",
  media: "bg-amber-400/15 text-amber-500",
  baja: "bg-slate-400/15 text-fg-muted",
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  pendiente: "bg-amber-400/15 text-amber-500",
  en_progreso: "bg-blue-400/15 text-blue-400",
  completada: "bg-emerald-400/15 text-emerald-400",
  cancelada: "bg-slate-400/15 text-fg-muted",
};

export function TaskPriorityChip({ prioridad }: { prioridad: TaskPriority }) {
  return (
    <span className={`chip text-[10px] ${PRIORITY_CLASS[prioridad]}`}>
      {TASK_PRIORITY_LABELS[prioridad]}
    </span>
  );
}

export function TaskStatusChip({ estado }: { estado: TaskStatus }) {
  return (
    <span className={`chip text-[10px] ${STATUS_CLASS[estado]}`}>
      {TASK_STATUS_LABELS[estado]}
    </span>
  );
}

export function OverdueChip() {
  return <span className="chip text-[10px] bg-red-500/15 text-red-400">Vencida</span>;
}
