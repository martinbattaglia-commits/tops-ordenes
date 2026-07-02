// Nexus Link · dominio — Tareas colaborativas (F4.3). PURO, sin I/O.
// Espeja la máquina de estados de 0169 (fuente de verdad = RPC; esto es UX:
// qué acciones ofrecer y validación temprana — el server SIEMPRE re-valida).
//
//   pendiente → en_progreso → completada  |  cancelada (desde no-terminal)
//   reapertura: completada → en_progreso (auditada) · cancelada = TERMINAL
//   claim SOLO de vacantes · devolución del asignado ·
//   reasignación = creador o task_admin (D-F43-3).

import type { Task, TaskPriority, TaskStatus } from "../types";
import { TASK_PRIORITIES } from "../types";

export const MAX_TASK_TITLE = 160;
export const MAX_TASK_DESCRIPTION = 4000;
export const MAX_CANCEL_REASON = 300;

export interface TaskViewer {
  userId: string | null;
  /** has_permission('connect.task_admin') — resuelto fail-closed. */
  isTaskAdmin: boolean;
  /** ¿El viewer figura como seguidor? (resuelto en read). */
  isFollower?: boolean;
}

export function isTaskAssignee(t: Task, v: TaskViewer): boolean {
  return v.userId != null && t.asignadoA != null && t.asignadoA === v.userId;
}

export function isTaskCreator(t: Task, v: TaskViewer): boolean {
  return v.userId != null && t.creadoPor != null && t.creadoPor === v.userId;
}

export type TaskAction =
  | "claim"          // vacante → me la asigno (RPC assign p_to=self)
  | "assign"         // asignar/reasignar a terceros (creador o task_admin)
  | "return"         // devolver (asignado; también creador/task_admin des-asignan)
  | "start"          // pendiente → en_progreso
  | "complete"       // → completada
  | "cancel"         // → cancelada (con motivo)
  | "reopen"         // completada → en_progreso
  | "set_priority"
  | "set_due"
  | "follow"         // seguirme / dejar de seguir
  | "add_follower";  // agregar seguidores (creador o task_admin)

export const TASK_ACTION_TARGET_STATUS: Partial<Record<TaskAction, TaskStatus>> = {
  start: "en_progreso",
  complete: "completada",
  cancel: "cancelada",
  reopen: "en_progreso",
};

/** Acciones disponibles para el viewer (espejo UX de 0169). */
export function availableTaskActions(t: Task, v: TaskViewer): TaskAction[] {
  const admin = v.isTaskAdmin;
  const assignee = isTaskAssignee(t, v);
  const creator = isTaskCreator(t, v);
  const terminal = t.estado === "completada" || t.estado === "cancelada";
  const out: TaskAction[] = [];

  if (t.estado === "cancelada") return out; // terminal absoluto

  // Asignación (claim SOLO vacante — lección I-1 heredada).
  if (!terminal) {
    if (creator || admin) out.push("assign");
    if (t.asignadoA == null && v.userId != null) out.push("claim");
    if (t.asignadoA != null && (assignee || creator || admin)) out.push("return");
  }

  switch (t.estado) {
    case "pendiente":
      if (assignee || admin) out.push("start");
      if (assignee || creator || admin) out.push("complete");
      if (creator || admin) out.push("cancel");
      break;
    case "en_progreso":
      if (assignee || creator || admin) out.push("complete");
      if (creator || admin) out.push("cancel");
      break;
    case "completada":
      if (creator || assignee || admin) out.push("reopen");
      break;
  }

  if (!terminal && (creator || assignee || admin)) {
    out.push("set_priority", "set_due");
  }
  if (creator || admin) out.push("add_follower");
  // Seguir/dejar de seguir: cualquier viewer con acceso (la página solo se ve con acceso).
  if (v.userId != null && !creator) out.push("follow");

  return out;
}

/** Validación temprana del alta (el RPC re-valida). */
export function validateTaskInput(input: {
  titulo: string;
  prioridad: string;
}): { ok: true; titulo: string; prioridad: TaskPriority } | { ok: false; message: string } {
  const titulo = input.titulo.trim();
  if (titulo.length === 0) return { ok: false, message: "El título de la tarea es obligatorio." };
  if (titulo.length > MAX_TASK_TITLE) {
    return { ok: false, message: `El título no puede superar ${MAX_TASK_TITLE} caracteres.` };
  }
  if (!(TASK_PRIORITIES as readonly string[]).includes(input.prioridad)) {
    return { ok: false, message: "Prioridad inválida." };
  }
  return { ok: true, titulo, prioridad: input.prioridad as TaskPriority };
}

/** Validación temprana del motivo de cancelación (el RPC re-valida). */
export function validateCancelReason(text: string): { ok: true; text: string } | { ok: false; message: string } {
  const t = text.trim();
  if (t.length === 0) return { ok: false, message: "La cancelación requiere un motivo breve." };
  if (t.length > MAX_CANCEL_REASON) {
    return { ok: false, message: `El motivo no puede superar ${MAX_CANCEL_REASON} caracteres.` };
  }
  return { ok: true, text: t };
}

/** Orden por prioridad (urgente primero). */
export function taskPriorityRank(p: TaskPriority): number {
  switch (p) {
    case "urgente": return 0;
    case "alta": return 1;
    case "media": return 2;
    case "baja": return 3;
  }
}

export function isOpenTask(s: TaskStatus): boolean {
  return s === "pendiente" || s === "en_progreso";
}

/** Vencida = derivado de lectura (ADR §9): due pasado y no terminal. */
export function isOverdue(t: Task, nowIso: string): boolean {
  return t.dueAt != null && isOpenTask(t.estado) && Date.parse(t.dueAt) < Date.parse(nowIso);
}
