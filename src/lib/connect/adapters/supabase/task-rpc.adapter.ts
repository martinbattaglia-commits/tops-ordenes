// Nexus Link · driven adapter (Supabase) del Centro de Tareas (F4.3).
// Implementa TaskWritePort invocando las RPCs SECDEF de 0169 POR SESIÓN.

import { ok, err, domainError, type Result } from "../../domain/result";
import type {
  CreateTaskInput, CreateTaskOutput, InstantiateWorkflowOutput, TaskWritePort,
} from "../../ports/task-port";
import type { TaskPriority, TaskStatus } from "../../types";
import type { RpcCapableClient } from "./connect-rpc.adapter";

function mapTaskPgError(message: string): string {
  if (/tarea inexistente/i.test(message)) return "La tarea no existe.";
  if (/estado terminal|está cancelada/i.test(message)) return "La tarea está en un estado terminal.";
  if (/transición inválida/i.test(message)) return "Esa transición de estado no está permitida.";
  if (/motivo breve/i.test(message)) return "La cancelación requiere un motivo breve.";
  if (/workflow inexistente|no tiene paso/i.test(message)) return "El workflow no está disponible.";
  if (/incidente inexistente/i.test(message)) return "El incidente vinculado no existe o no tenés acceso.";
  if (/no es un interno válido/i.test(message)) return "El usuario elegido no es un interno válido.";
  if (/task_admin|solo el asignado|solo el creador|solo asignado|solo creador|sin acceso|insufficient_privilege|permiso/i.test(message)) {
    return "No tenés permiso para esta acción sobre la tarea.";
  }
  if (/título .* obligatorio/i.test(message)) return "El título de la tarea es obligatorio.";
  if (/prioridad inválida|estado inválido|check_violation/i.test(message)) return "Datos inválidos.";
  return message;
}

export class TaskRpcAdapter implements TaskWritePort {
  constructor(private readonly client: RpcCapableClient) {}

  async create(input: CreateTaskInput): Promise<Result<CreateTaskOutput>> {
    const { data, error } = await this.client.rpc("connect_task_create", {
      p_titulo: input.titulo,
      p_descripcion: input.descripcion,
      p_prioridad: input.prioridad,
      p_due_at: input.dueAt,
      p_asignado: input.asignado,
      p_incident_id: input.incidentId,
    });
    if (error) return err(domainError("rpc_error", mapTaskPgError(error.message)));
    const row = Array.isArray(data)
      ? (data[0] as { id: string; public_id: string } | undefined)
      : null;
    if (!row) return err(domainError("rpc_error", "El alta no devolvió la tarea creada."));
    return ok({ id: row.id, publicId: row.public_id });
  }

  async assign(taskId: string, toProfileId: string | null): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_task_assign", {
      p_id: taskId,
      p_to: toProfileId,
    });
    if (error) return err(domainError("rpc_error", mapTaskPgError(error.message)));
    return ok(undefined);
  }

  async setStatus(taskId: string, status: TaskStatus, motivo?: string | null): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_task_set_status", {
      p_id: taskId,
      p_status: status,
      p_motivo: motivo ?? null,
    });
    if (error) return err(domainError("rpc_error", mapTaskPgError(error.message)));
    return ok(undefined);
  }

  async setPriority(taskId: string, priority: TaskPriority): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_task_set_priority", {
      p_id: taskId,
      p_prioridad: priority,
    });
    if (error) return err(domainError("rpc_error", mapTaskPgError(error.message)));
    return ok(undefined);
  }

  async setDue(taskId: string, dueAt: string | null): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_task_set_due", {
      p_id: taskId,
      p_due: dueAt,
    });
    if (error) return err(domainError("rpc_error", mapTaskPgError(error.message)));
    return ok(undefined);
  }

  async follow(taskId: string, userId: string, follow: boolean): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_task_follow", {
      p_id: taskId,
      p_user: userId,
      p_follow: follow,
    });
    if (error) return err(domainError("rpc_error", mapTaskPgError(error.message)));
    return ok(undefined);
  }

  async ensureThread(taskId: string): Promise<Result<{ conversationId: string }>> {
    const { data, error } = await this.client.rpc("connect_task_ensure_thread", { p_id: taskId });
    if (error) return err(domainError("rpc_error", mapTaskPgError(error.message)));
    if (!data) return err(domainError("rpc_error", "No se pudo crear el hilo de la tarea."));
    return ok({ conversationId: String(data) });
  }

  async instantiateWorkflow(templateId: string): Promise<Result<InstantiateWorkflowOutput>> {
    const { data, error } = await this.client.rpc("connect_workflow_instantiate", {
      p_template_id: templateId,
    });
    if (error) return err(domainError("rpc_error", mapTaskPgError(error.message)));
    const row = Array.isArray(data)
      ? (data[0] as { instance_id: string; task_id: string; task_public_id: string } | undefined)
      : null;
    if (!row) return err(domainError("rpc_error", "El workflow no devolvió la instancia creada."));
    return ok({ instanceId: row.instance_id, taskId: row.task_id, taskPublicId: row.task_public_id });
  }
}
