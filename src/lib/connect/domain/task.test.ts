import { describe, it, expect } from "vitest";
import {
  availableTaskActions, isOpenTask, isOverdue, isTaskAssignee, isTaskCreator,
  taskPriorityRank, validateCancelReason, validateTaskInput, MAX_TASK_TITLE,
  type TaskViewer,
} from "./task";
import type { Task } from "../types";

function task(over: Partial<Task> = {}): Task {
  return {
    id: "tsk-1", publicId: "TSK-2026-0001", titulo: "Reparar portón",
    descripcion: null, estado: "pendiente", prioridad: "media", dueAt: null,
    creadoPor: "u-crea", asignadoA: null, conversationId: null,
    incidentId: null, workflowInstanceId: null, stepNo: null, area: null,
    cancelReason: null, completedAt: null,
    createdAt: "2026-06-30T10:00:00.000Z", updatedAt: "2026-06-30T10:00:00.000Z",
    ...over,
  };
}

const admin: TaskViewer = { userId: "u-admin", isTaskAdmin: true };
const creator: TaskViewer = { userId: "u-crea", isTaskAdmin: false };
const assignee: TaskViewer = { userId: "u-asig", isTaskAdmin: false };
const outsider: TaskViewer = { userId: "u-otro", isTaskAdmin: false };

describe("connect/domain/task · roles NULL-safe", () => {
  it("isTaskAssignee / isTaskCreator con nulls", () => {
    const t = task({ creadoPor: null, asignadoA: null });
    expect(isTaskAssignee(t, { userId: null, isTaskAdmin: false })).toBe(false);
    expect(isTaskCreator(t, { userId: null, isTaskAdmin: false })).toBe(false);
    expect(isTaskAssignee(t, outsider)).toBe(false);
  });
});

describe("connect/domain/task · availableTaskActions (espejo de 0169)", () => {
  it("cancelada es terminal absoluto: sin acciones de gestión", () => {
    const t = task({ estado: "cancelada", asignadoA: "u-asig" });
    expect(availableTaskActions(t, admin)).toEqual([]);
    expect(availableTaskActions(t, creator)).toEqual([]);
  });

  it("cancelada · un seguidor puede DEJAR de seguir (fix I-4)", () => {
    const t = task({ estado: "cancelada" });
    const follower: TaskViewer = { userId: "u-fan", isTaskAdmin: false, isFollower: true };
    expect(availableTaskActions(t, follower)).toEqual(["follow"]);
    expect(availableTaskActions(t, { ...follower, isFollower: false })).toEqual([]);
  });

  it("pendiente VACANTE · un tercero solo puede reclamar y seguir", () => {
    const t = task({ estado: "pendiente", asignadoA: null });
    const acts = availableTaskActions(t, outsider);
    expect(acts).toContain("claim");
    expect(acts).toContain("follow");
    expect(acts).not.toContain("assign");
    expect(acts).not.toContain("complete");
    expect(acts).not.toContain("cancel");
  });

  it("pendiente YA asignada · tercero no puede reclamar (no robo — lección I-1)", () => {
    const t = task({ estado: "pendiente", asignadoA: "u-asig" });
    const acts = availableTaskActions(t, outsider);
    expect(acts).not.toContain("claim");
    expect(acts).not.toContain("return");
    expect(acts).not.toContain("start");
  });

  it("asignado puede iniciar, completar y devolver; NO cancelar", () => {
    const t = task({ estado: "pendiente", asignadoA: "u-asig" });
    const acts = availableTaskActions(t, assignee);
    expect(acts).toContain("start");
    expect(acts).toContain("complete");
    expect(acts).toContain("return");
    expect(acts).not.toContain("cancel");
    expect(acts).not.toContain("assign"); // reasignar a terceros = creador/task_admin
  });

  it("creador puede reasignar (D-F43-3), completar y cancelar; NO iniciar sin ser asignado", () => {
    const t = task({ estado: "pendiente", asignadoA: "u-asig" });
    const acts = availableTaskActions(t, creator);
    expect(acts).toContain("assign");
    expect(acts).toContain("complete");
    expect(acts).toContain("cancel");
    expect(acts).not.toContain("start");
    expect(acts).not.toContain("follow"); // creador = seguidor implícito
  });

  it("en_progreso · asignado completa; creador cancela", () => {
    const t = task({ estado: "en_progreso", asignadoA: "u-asig" });
    expect(availableTaskActions(t, assignee)).toContain("complete");
    expect(availableTaskActions(t, creator)).toContain("cancel");
    expect(availableTaskActions(t, assignee)).not.toContain("start");
  });

  it("completada · creador/asignado/admin pueden reabrir; tercero no", () => {
    const t = task({ estado: "completada", asignadoA: "u-asig" });
    expect(availableTaskActions(t, creator)).toContain("reopen");
    expect(availableTaskActions(t, assignee)).toContain("reopen");
    expect(availableTaskActions(t, admin)).toContain("reopen");
    expect(availableTaskActions(t, outsider)).not.toContain("reopen");
  });

  it("completada · sin claim/assign/priority/due (terminal para gestión)", () => {
    const t = task({ estado: "completada", asignadoA: null });
    const acts = availableTaskActions(t, admin);
    expect(acts).not.toContain("claim");
    expect(acts).not.toContain("assign");
    expect(acts).not.toContain("set_priority");
    expect(acts).not.toContain("set_due");
  });

  it("task_admin tiene gestión completa en estados vivos", () => {
    const t = task({ estado: "en_progreso", asignadoA: "u-asig" });
    const acts = availableTaskActions(t, admin);
    expect(acts).toEqual(expect.arrayContaining(["assign", "return", "complete", "cancel", "set_priority", "set_due", "add_follower"]));
  });

  it("viewer sin sesión no recibe claim/follow", () => {
    const t = task({ estado: "pendiente", asignadoA: null });
    const acts = availableTaskActions(t, { userId: null, isTaskAdmin: false });
    expect(acts).not.toContain("claim");
    expect(acts).not.toContain("follow");
  });
});

describe("connect/domain/task · validaciones", () => {
  it("validateTaskInput exige título y prioridad válida", () => {
    expect(validateTaskInput({ titulo: "  ", prioridad: "media" }).ok).toBe(false);
    expect(validateTaskInput({ titulo: "x".repeat(MAX_TASK_TITLE + 1), prioridad: "media" }).ok).toBe(false);
    expect(validateTaskInput({ titulo: "Reparar", prioridad: "extrema" }).ok).toBe(false);
    const v = validateTaskInput({ titulo: "  Reparar  ", prioridad: "urgente" });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.titulo).toBe("Reparar");
      expect(v.prioridad).toBe("urgente");
    }
  });

  it("validateCancelReason exige motivo", () => {
    expect(validateCancelReason("  ").ok).toBe(false);
    const v = validateCancelReason("  Ya no aplica.  ");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.text).toBe("Ya no aplica.");
  });
});

describe("connect/domain/task · derivados", () => {
  it("taskPriorityRank ordena urgente primero", () => {
    expect(taskPriorityRank("urgente")).toBeLessThan(taskPriorityRank("alta"));
    expect(taskPriorityRank("alta")).toBeLessThan(taskPriorityRank("media"));
    expect(taskPriorityRank("media")).toBeLessThan(taskPriorityRank("baja"));
  });

  it("isOverdue: solo abiertas con due pasado (ADR §9: derivado, no estado)", () => {
    const now = "2026-07-01T12:00:00.000Z";
    expect(isOverdue(task({ dueAt: "2026-06-30T00:00:00.000Z", estado: "pendiente" }), now)).toBe(true);
    expect(isOverdue(task({ dueAt: "2026-07-02T00:00:00.000Z", estado: "pendiente" }), now)).toBe(false);
    expect(isOverdue(task({ dueAt: "2026-06-30T00:00:00.000Z", estado: "completada" }), now)).toBe(false);
    expect(isOverdue(task({ dueAt: null, estado: "pendiente" }), now)).toBe(false);
  });

  it("isOpenTask", () => {
    expect(isOpenTask("pendiente")).toBe(true);
    expect(isOpenTask("en_progreso")).toBe(true);
    expect(isOpenTask("completada")).toBe(false);
    expect(isOpenTask("cancelada")).toBe(false);
  });
});
