// Nexus Link · use-cases del Centro de Tareas (F4.3). Sin Supabase directo:
// validación temprana de dominio + puerto inyectado. Autoridad final = RPCs 0169.

import { err, domainError, type Result } from "../domain/result";
import {
  MAX_TASK_DESCRIPTION, validateCancelReason, validateTaskInput,
} from "../domain/task";
import type {
  CreateTaskOutput, InstantiateWorkflowOutput, TaskWritePort,
} from "../ports/task-port";
import type { TaskPriority, TaskStatus } from "../types";
import { TASK_PRIORITIES, TASK_STATUSES } from "../types";

function clean(s: string | null | undefined, max: number): string | null {
  const t = (s ?? "").trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

export class CreateTaskUseCase {
  constructor(private readonly port: TaskWritePort) {}

  async execute(input: {
    titulo: string;
    descripcion?: string | null;
    prioridad: string;
    dueAt?: string | null;
    asignado?: string | null;
    incidentId?: string | null;
  }): Promise<Result<CreateTaskOutput>> {
    const v = validateTaskInput({ titulo: input.titulo, prioridad: input.prioridad });
    if (!v.ok) return err(domainError("invalid_input", v.message));
    return this.port.create({
      titulo: v.titulo,
      descripcion: clean(input.descripcion, MAX_TASK_DESCRIPTION),
      prioridad: v.prioridad,
      dueAt: input.dueAt ?? null,
      asignado: input.asignado ?? null,
      incidentId: input.incidentId ?? null,
    });
  }
}

export class AssignTaskUseCase {
  constructor(private readonly port: TaskWritePort) {}

  /** toProfileId null = devolución. */
  async execute(input: { taskId: string; toProfileId: string | null }): Promise<Result<void>> {
    if (!input.taskId) return err(domainError("invalid_input", "Falta la tarea."));
    return this.port.assign(input.taskId, input.toProfileId);
  }
}

export class SetTaskStatusUseCase {
  constructor(private readonly port: TaskWritePort) {}

  async execute(input: { taskId: string; status: string; motivo?: string | null }): Promise<Result<void>> {
    if (!(TASK_STATUSES as readonly string[]).includes(input.status)) {
      return err(domainError("invalid_input", "Estado inválido."));
    }
    if (input.status === "cancelada") {
      const v = validateCancelReason(input.motivo ?? "");
      if (!v.ok) return err(domainError("invalid_input", v.message));
      return this.port.setStatus(input.taskId, "cancelada", v.text);
    }
    return this.port.setStatus(input.taskId, input.status as TaskStatus, null);
  }
}

export class SetTaskPriorityUseCase {
  constructor(private readonly port: TaskWritePort) {}

  async execute(input: { taskId: string; priority: string }): Promise<Result<void>> {
    if (!(TASK_PRIORITIES as readonly string[]).includes(input.priority)) {
      return err(domainError("invalid_input", "Prioridad inválida."));
    }
    return this.port.setPriority(input.taskId, input.priority as TaskPriority);
  }
}

export class SetTaskDueUseCase {
  constructor(private readonly port: TaskWritePort) {}

  async execute(input: { taskId: string; dueAt: string | null }): Promise<Result<void>> {
    if (input.dueAt != null && Number.isNaN(Date.parse(input.dueAt))) {
      return err(domainError("invalid_input", "Fecha límite inválida."));
    }
    return this.port.setDue(input.taskId, input.dueAt);
  }
}

export class FollowTaskUseCase {
  constructor(private readonly port: TaskWritePort) {}

  async execute(input: { taskId: string; userId: string; follow: boolean }): Promise<Result<void>> {
    if (!input.taskId || !input.userId) {
      return err(domainError("invalid_input", "Falta la tarea o el usuario."));
    }
    return this.port.follow(input.taskId, input.userId, input.follow);
  }
}

export class EnsureTaskThreadUseCase {
  constructor(private readonly port: TaskWritePort) {}

  async execute(input: { taskId: string }): Promise<Result<{ conversationId: string }>> {
    if (!input.taskId) return err(domainError("invalid_input", "Falta la tarea."));
    return this.port.ensureThread(input.taskId);
  }
}

export class InstantiateWorkflowUseCase {
  constructor(private readonly port: TaskWritePort) {}

  async execute(input: { templateId: string }): Promise<Result<InstantiateWorkflowOutput>> {
    if (!input.templateId) return err(domainError("invalid_input", "Falta el workflow."));
    return this.port.instantiateWorkflow(input.templateId);
  }
}
