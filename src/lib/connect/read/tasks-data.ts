// Nexus Link · capa de LECTURA del Centro de Tareas (F4.3).
// Patrón canónico (incidents-data.ts): isMock() → seeds; createClient()→null →
// seeds; real → connect_tasks bajo RLS privado-por-involucrados (0168).
// Lectura por SESIÓN. Nombres vía profiles_public (lockdown 0040 / lección I-1).
// Orden de negocio EN SQL antes del límite (lección I-4).

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type {
  Task, TaskFollower, TaskPriority, TaskRow, TaskStatus, WorkflowTemplate,
} from "../types";
import { taskPriorityRank } from "../domain/task";
import { MOCK_TASKS, MOCK_WORKFLOW_TEMPLATES } from "../tasks-mock";
import { MOCK_CURRENT_USER_ID, MOCK_USERS } from "../mock";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

const TASK_COLS =
  "id, public_id, titulo, descripcion, estado, prioridad, due_at, creado_por, asignado_a, conversation_id, incident_id, workflow_instance_id, step_no, area, cancel_reason, completed_at, created_at, updated_at";

export type TaskView = "abiertas" | "mias" | "creadas" | "vacantes" | "todas";

export interface TaskFilters {
  vista?: TaskView;
  estado?: TaskStatus;
  prioridad?: TaskPriority;
  incidentId?: string;
}

function mapTask(r: TaskRow): Task {
  return {
    id: r.id, publicId: r.public_id, titulo: r.titulo, descripcion: r.descripcion,
    estado: r.estado, prioridad: r.prioridad, dueAt: r.due_at,
    creadoPor: r.creado_por, asignadoA: r.asignado_a,
    conversationId: r.conversation_id, incidentId: r.incident_id,
    workflowInstanceId: r.workflow_instance_id, stepNo: r.step_no, area: r.area,
    cancelReason: r.cancel_reason, completedAt: r.completed_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

async function withNames(items: Task[]): Promise<Task[]> {
  const ids = Array.from(
    new Set(items.flatMap((t) => [t.creadoPor, t.asignadoA]).filter((x): x is string => x != null)),
  );
  if (ids.length === 0) return items;
  const supabase = createClient();
  if (!supabase) return items;
  const { data, error } = await supabase
    .from("profiles_public")
    .select("id, full_name")
    .in("id", ids);
  if (error || !data) return items;
  const names = new Map<string, string>();
  for (const p of data as Array<{ id: string; full_name: string | null }>) {
    const n = (p.full_name ?? "").trim();
    if (n) names.set(p.id, n);
  }
  return items.map((t) => ({
    ...t,
    creadoPorName: t.creadoPor ? (names.get(t.creadoPor) ?? null) : null,
    asignadoAName: t.asignadoA ? (names.get(t.asignadoA) ?? null) : null,
  }));
}

function applyMockFilters(items: Task[], f: TaskFilters, uid: string): Task[] {
  return items.filter((t) => {
    if (f.incidentId && t.incidentId !== f.incidentId) return false;
    if (f.estado && t.estado !== f.estado) return false;
    if (f.prioridad && t.prioridad !== f.prioridad) return false;
    switch (f.vista ?? "abiertas") {
      case "mias": return t.asignadoA === uid;
      case "creadas": return t.creadoPor === uid;
      case "vacantes": return t.asignadoA == null && (t.estado === "pendiente" || t.estado === "en_progreso");
      case "todas": return true;
      case "abiertas":
      default:
        // Espejo del SQL (fix M-2 adversarial): un filtro de estado explícito
        // reemplaza la restricción "abiertas".
        return f.estado ? true : (t.estado === "pendiente" || t.estado === "en_progreso");
    }
  });
}

function sortTasks(items: Task[]): Task[] {
  return [...items].sort((a, b) => {
    const pr = taskPriorityRank(a.prioridad) - taskPriorityRank(b.prioridad);
    if (pr !== 0) return pr;
    const da = a.dueAt ? Date.parse(a.dueAt) : Number.MAX_SAFE_INTEGER;
    const db = b.dueAt ? Date.parse(b.dueAt) : Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}

/** Lista de gestión: urgente primero, vencimiento después (orden EN SQL pre-límite). */
export async function listTasks(filters: TaskFilters = {}): Promise<Task[]> {
  if (isMock()) return sortTasks(applyMockFilters(MOCK_TASKS, filters, MOCK_CURRENT_USER_ID));
  const supabase = createClient();
  if (!supabase) return sortTasks(applyMockFilters(MOCK_TASKS, filters, MOCK_CURRENT_USER_ID));

  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id ?? null;

  let query = supabase.from("connect_tasks").select(TASK_COLS);
  if (filters.incidentId) query = query.eq("incident_id", filters.incidentId);
  if (filters.estado) query = query.eq("estado", filters.estado);
  if (filters.prioridad) query = query.eq("prioridad", filters.prioridad);
  switch (filters.vista ?? "abiertas") {
    case "mias":
      if (!uid) return []; // fix M-3 adversarial: sin sesión NO degradar a "todas"
      query = query.eq("asignado_a", uid);
      break;
    case "creadas":
      if (!uid) return [];
      query = query.eq("creado_por", uid);
      break;
    case "vacantes":
      query = query.is("asignado_a", null).in("estado", ["pendiente", "en_progreso"]);
      break;
    case "todas":
      break;
    case "abiertas":
    default:
      if (!filters.estado) query = query.in("estado", ["pendiente", "en_progreso"]);
      break;
  }
  // El enum prioridad se declara baja→urgente: descending = urgente primero.
  query = query
    .order("prioridad", { ascending: false })
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(200);

  const { data, error } = await query;
  if (error) {
    console.error("[connect/listTasks] query error:", error.message);
    return [];
  }
  const items = (data ?? []).map((r) => mapTask(r as unknown as TaskRow));
  return sortTasks(await withNames(items));
}

/** Una tarea por id (detalle). */
export async function getTask(id: string): Promise<Task | null> {
  if (isMock()) return MOCK_TASKS.find((t) => t.id === id) ?? null;
  const supabase = createClient();
  if (!supabase) return MOCK_TASKS.find((t) => t.id === id) ?? null;
  const { data, error } = await supabase
    .from("connect_tasks")
    .select(TASK_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const [item] = await withNames([mapTask(data as unknown as TaskRow)]);
  return item ?? null;
}

/** Seguidores de una tarea, con nombre (profiles_public). */
export async function listTaskFollowers(taskId: string): Promise<TaskFollower[]> {
  if (isMock()) {
    return taskId === "tsk-1"
      ? [{ taskId, profileId: MOCK_USERS.u2.id, name: MOCK_USERS.u2.name }]
      : [];
  }
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("connect_task_followers")
    .select("task_id, profile_id")
    .eq("task_id", taskId);
  if (error || !data || data.length === 0) return [];
  const rows = data as Array<{ task_id: string; profile_id: string }>;
  const { data: profs } = await supabase
    .from("profiles_public")
    .select("id, full_name")
    .in("id", rows.map((r) => r.profile_id));
  const names = new Map((profs ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? null]));
  return rows.map((r) => ({ taskId: r.task_id, profileId: r.profile_id, name: names.get(r.profile_id) ?? null }));
}

/**
 * ¿El usuario es admin de tareas? FAIL-CLOSED vía RPC has_permission
 * (lección I-2: no usar canAccess fail-open para espejos de botonera).
 */
export async function hasTaskAdmin(): Promise<boolean> {
  if (isMock()) return true;
  const supabase = createClient();
  if (!supabase) return true;
  const { data, error } = await supabase.rpc("has_permission", { p_slug: "connect.task_admin" });
  if (error) return false;
  return data === true;
}

/** Plantillas de workflow activas (catálogo por seed, D-F43-6). */
export async function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  if (isMock()) return MOCK_WORKFLOW_TEMPLATES;
  const supabase = createClient();
  if (!supabase) return MOCK_WORKFLOW_TEMPLATES;
  const { data, error } = await supabase
    .from("connect_workflow_templates")
    .select("id, nombre, descripcion, activo, connect_workflow_steps(step_no, titulo, rol_sugerido)")
    .eq("activo", true)
    .order("nombre");
  if (error || !data) {
    if (error) console.error("[connect/listWorkflowTemplates] query error:", error.message);
    return [];
  }
  return (data as Array<Record<string, unknown>>).map((t) => ({
    id: t.id as string,
    nombre: t.nombre as string,
    descripcion: (t.descripcion as string | null) ?? null,
    activo: Boolean(t.activo),
    steps: ((t.connect_workflow_steps as Array<Record<string, unknown>>) ?? [])
      .map((s) => ({
        stepNo: Number(s.step_no),
        titulo: s.titulo as string,
        rolSugerido: (s.rol_sugerido as string | null) ?? null,
      }))
      .sort((a, b) => a.stepNo - b.stepNo),
  }));
}
