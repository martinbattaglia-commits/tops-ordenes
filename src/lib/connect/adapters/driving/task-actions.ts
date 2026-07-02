"use server";

// Nexus Link · driving adapter (server actions del Centro de Tareas, F4.3).
// Patrón canónico (incident-actions.ts): createClient→getUser→canAccess→zod→
// use-case(adapter sesión)→revalidatePath→union. Los RPCs de 0169 re-validan
// máquina/permisos y auditan al usuario real.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccess } from "@/lib/rbac/guard";
import { createClient } from "@/lib/supabase/server";
import {
  AssignTaskUseCase, CreateTaskUseCase, EnsureTaskThreadUseCase, FollowTaskUseCase,
  InstantiateWorkflowUseCase, SetTaskDueUseCase, SetTaskPriorityUseCase, SetTaskStatusUseCase,
} from "../../application/task-use-cases";
import { TaskRpcAdapter } from "../supabase/task-rpc.adapter";
import type { RpcCapableClient } from "../supabase/connect-rpc.adapter";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../types";

export type SimpleTaskResult = { ok: true } | { ok: false; message: string };
export type CreateTaskResult =
  | { ok: true; id: string; publicId: string }
  | { ok: false; message: string };
export type EnsureThreadResult =
  | { ok: true; conversationId: string }
  | { ok: false; message: string };
export type InstantiateWorkflowResult =
  | { ok: true; taskId: string; taskPublicId: string }
  | { ok: false; message: string };

type Guarded =
  | { ok: true; client: RpcCapableClient }
  | { ok: false; message: string };

async function guard(perm: "connect.view" | "connect.create"): Promise<Guarded> {
  const supabase = createClient();
  if (!supabase) {
    return { ok: false, message: "Modo demo: la acción no se persiste (sin Supabase configurado)." };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess(perm))) {
    return { ok: false, message: `Sin permiso para esta acción (${perm}).` };
  }
  return { ok: true, client: supabase as unknown as RpcCapableClient };
}

function revalidateTasks(taskId?: string) {
  revalidatePath("/connect/tareas");
  if (taskId) revalidatePath(`/connect/tareas/${taskId}`);
}

const CreateSchema = z.object({
  titulo: z.string().min(1).max(160),
  descripcion: z.string().max(4000).nullable().optional(),
  prioridad: z.enum(TASK_PRIORITIES),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  asignado: z.string().uuid().nullable().optional(),
  incidentId: z.string().uuid().nullable().optional(),
});

export async function createTaskAction(raw: unknown): Promise<CreateTaskResult> {
  const g = await guard("connect.create");
  if (!g.ok) return g;
  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new CreateTaskUseCase(new TaskRpcAdapter(g.client)).execute({
    titulo: parsed.data.titulo,
    descripcion: parsed.data.descripcion ?? null,
    prioridad: parsed.data.prioridad,
    dueAt: parsed.data.dueAt ?? null,
    asignado: parsed.data.asignado ?? null,
    incidentId: parsed.data.incidentId ?? null,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateTasks(result.value.id);
  return { ok: true, id: result.value.id, publicId: result.value.publicId };
}

const AssignSchema = z.object({
  taskId: z.string().uuid(),
  toProfileId: z.string().uuid().nullable(),
});

export async function assignTaskAction(raw: unknown): Promise<SimpleTaskResult> {
  const g = await guard("connect.view");
  if (!g.ok) return g;
  const parsed = AssignSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new AssignTaskUseCase(new TaskRpcAdapter(g.client)).execute({
    taskId: parsed.data.taskId,
    toProfileId: parsed.data.toProfileId,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateTasks(parsed.data.taskId);
  return { ok: true };
}

const SetStatusSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(TASK_STATUSES),
  motivo: z.string().max(300).nullable().optional(),
});

export async function setTaskStatusAction(raw: unknown): Promise<SimpleTaskResult> {
  const g = await guard("connect.view");
  if (!g.ok) return g;
  const parsed = SetStatusSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new SetTaskStatusUseCase(new TaskRpcAdapter(g.client)).execute({
    taskId: parsed.data.taskId,
    status: parsed.data.status,
    motivo: parsed.data.motivo ?? null,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateTasks(parsed.data.taskId);
  return { ok: true };
}

const SetPrioritySchema = z.object({
  taskId: z.string().uuid(),
  priority: z.enum(TASK_PRIORITIES),
});

export async function setTaskPriorityAction(raw: unknown): Promise<SimpleTaskResult> {
  const g = await guard("connect.view");
  if (!g.ok) return g;
  const parsed = SetPrioritySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new SetTaskPriorityUseCase(new TaskRpcAdapter(g.client)).execute({
    taskId: parsed.data.taskId,
    priority: parsed.data.priority,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateTasks(parsed.data.taskId);
  return { ok: true };
}

const SetDueSchema = z.object({
  taskId: z.string().uuid(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
});

export async function setTaskDueAction(raw: unknown): Promise<SimpleTaskResult> {
  const g = await guard("connect.view");
  if (!g.ok) return g;
  const parsed = SetDueSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new SetTaskDueUseCase(new TaskRpcAdapter(g.client)).execute({
    taskId: parsed.data.taskId,
    dueAt: parsed.data.dueAt,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateTasks(parsed.data.taskId);
  return { ok: true };
}

const FollowSchema = z.object({
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  follow: z.boolean(),
});

export async function followTaskAction(raw: unknown): Promise<SimpleTaskResult> {
  const g = await guard("connect.view");
  if (!g.ok) return g;
  const parsed = FollowSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new FollowTaskUseCase(new TaskRpcAdapter(g.client)).execute(parsed.data);
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateTasks(parsed.data.taskId);
  return { ok: true };
}

const EnsureThreadSchema = z.object({ taskId: z.string().uuid() });

export async function ensureTaskThreadAction(raw: unknown): Promise<EnsureThreadResult> {
  const g = await guard("connect.view");
  if (!g.ok) return g;
  const parsed = EnsureThreadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new EnsureTaskThreadUseCase(new TaskRpcAdapter(g.client)).execute(parsed.data);
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateTasks(parsed.data.taskId);
  return { ok: true, conversationId: result.value.conversationId };
}

const InstantiateSchema = z.object({ templateId: z.string().uuid() });

export async function instantiateWorkflowAction(raw: unknown): Promise<InstantiateWorkflowResult> {
  const g = await guard("connect.create");
  if (!g.ok) return g;
  const parsed = InstantiateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new InstantiateWorkflowUseCase(new TaskRpcAdapter(g.client)).execute(parsed.data);
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateTasks(result.value.taskId);
  return { ok: true, taskId: result.value.taskId, taskPublicId: result.value.taskPublicId };
}
