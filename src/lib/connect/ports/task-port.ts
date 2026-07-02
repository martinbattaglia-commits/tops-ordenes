// Nexus Link · puerto de escritura del Centro de Tareas (F4.3).
// Los use-cases dependen de esto; el driven adapter lo implementa vía las
// RPCs SECDEF de 0169 (RPC-first, G10).

import type { Result } from "../domain/result";
import type { TaskPriority, TaskStatus } from "../types";

export interface CreateTaskInput {
  titulo: string;
  descripcion: string | null;
  prioridad: TaskPriority;
  dueAt: string | null;
  asignado: string | null;
  incidentId: string | null;
}

export interface CreateTaskOutput {
  id: string;
  publicId: string;
}

export interface InstantiateWorkflowOutput {
  instanceId: string;
  taskId: string;
  taskPublicId: string;
}

export interface TaskWritePort {
  create(input: CreateTaskInput): Promise<Result<CreateTaskOutput>>;
  /** p_to null = devolución/des-asignación. */
  assign(taskId: string, toProfileId: string | null): Promise<Result<void>>;
  setStatus(taskId: string, status: TaskStatus, motivo?: string | null): Promise<Result<void>>;
  setPriority(taskId: string, priority: TaskPriority): Promise<Result<void>>;
  setDue(taskId: string, dueAt: string | null): Promise<Result<void>>;
  follow(taskId: string, userId: string, follow: boolean): Promise<Result<void>>;
  ensureThread(taskId: string): Promise<Result<{ conversationId: string }>>;
  instantiateWorkflow(templateId: string): Promise<Result<InstantiateWorkflowOutput>>;
}
