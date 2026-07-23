import { describe, it, expect } from "vitest";
import {
  AssignTaskUseCase, CreateTaskUseCase, EnsureTaskThreadUseCase, FollowTaskUseCase,
  InstantiateWorkflowUseCase, SetTaskDueUseCase, SetTaskPriorityUseCase, SetTaskStatusUseCase,
} from "./task-use-cases";
import { ok, type Result } from "../domain/result";
import type {
  CreateTaskInput, CreateTaskOutput, InstantiateWorkflowOutput, TaskWritePort,
} from "../ports/task-port";
import type { TaskPriority, TaskStatus } from "../types";

class FakeTaskPort implements TaskWritePort {
  public created: CreateTaskInput[] = [];
  public assigned: Array<{ id: string; to: string | null }> = [];
  public statuses: Array<{ id: string; status: TaskStatus; motivo: string | null }> = [];
  public priorities: Array<{ id: string; p: TaskPriority }> = [];
  public dues: Array<{ id: string; due: string | null }> = [];
  public follows: Array<{ id: string; user: string; on: boolean }> = [];
  public threads: string[] = [];
  public instantiated: string[] = [];

  async create(input: CreateTaskInput): Promise<Result<CreateTaskOutput>> {
    this.created.push(input);
    return ok({ id: "tsk-1", publicId: "TSK-2026-0001" });
  }
  async assign(id: string, to: string | null): Promise<Result<void>> {
    this.assigned.push({ id, to });
    return ok(undefined);
  }
  async setStatus(id: string, status: TaskStatus, motivo?: string | null): Promise<Result<void>> {
    this.statuses.push({ id, status, motivo: motivo ?? null });
    return ok(undefined);
  }
  async setPriority(id: string, p: TaskPriority): Promise<Result<void>> {
    this.priorities.push({ id, p });
    return ok(undefined);
  }
  async setDue(id: string, due: string | null): Promise<Result<void>> {
    this.dues.push({ id, due });
    return ok(undefined);
  }
  async follow(id: string, user: string, on: boolean): Promise<Result<void>> {
    this.follows.push({ id, user, on });
    return ok(undefined);
  }
  async ensureThread(id: string): Promise<Result<{ conversationId: string }>> {
    this.threads.push(id);
    return ok({ conversationId: "c-task-1" });
  }
  async instantiateWorkflow(templateId: string): Promise<Result<InstantiateWorkflowOutput>> {
    this.instantiated.push(templateId);
    return ok({ instanceId: "wfi-1", taskId: "tsk-2", taskPublicId: "TSK-2026-0002" });
  }
}

describe("connect/application · CreateTaskUseCase", () => {
  it("rechaza título vacío sin llegar al puerto", async () => {
    const port = new FakeTaskPort();
    const res = await new CreateTaskUseCase(port).execute({ titulo: "  ", prioridad: "media" });
    expect(res.ok).toBe(false);
    expect(port.created).toHaveLength(0);
  });

  it("rechaza prioridad inválida", async () => {
    const port = new FakeTaskPort();
    const res = await new CreateTaskUseCase(port).execute({ titulo: "Reparar", prioridad: "ya" });
    expect(res.ok).toBe(false);
    expect(port.created).toHaveLength(0);
  });

  it("normaliza (trim, vacío→null) y crea; propaga vínculo con incidente", async () => {
    const port = new FakeTaskPort();
    const res = await new CreateTaskUseCase(port).execute({
      titulo: "  Reparar portón  ",
      descripcion: "   ",
      prioridad: "alta",
      incidentId: "inc-1",
    });
    expect(res.ok).toBe(true);
    expect(port.created[0].titulo).toBe("Reparar portón");
    expect(port.created[0].descripcion).toBeNull();
    expect(port.created[0].incidentId).toBe("inc-1");
    expect(port.created[0].asignado).toBeNull(); // sin responsable = vacante
  });
});

describe("connect/application · SetTaskStatusUseCase", () => {
  it("rechaza estados fuera del enum", async () => {
    const port = new FakeTaskPort();
    const res = await new SetTaskStatusUseCase(port).execute({ taskId: "tsk-1", status: "pausada" });
    expect(res.ok).toBe(false);
    expect(port.statuses).toHaveLength(0);
  });

  it("cancelada exige motivo (invariante 0169)", async () => {
    const port = new FakeTaskPort();
    const sin = await new SetTaskStatusUseCase(port).execute({ taskId: "tsk-1", status: "cancelada", motivo: " " });
    expect(sin.ok).toBe(false);
    expect(port.statuses).toHaveLength(0);
    const con = await new SetTaskStatusUseCase(port).execute({ taskId: "tsk-1", status: "cancelada", motivo: " Ya no aplica " });
    expect(con.ok).toBe(true);
    expect(port.statuses).toEqual([{ id: "tsk-1", status: "cancelada", motivo: "Ya no aplica" }]);
  });

  it("transiciones normales no llevan motivo", async () => {
    const port = new FakeTaskPort();
    const res = await new SetTaskStatusUseCase(port).execute({ taskId: "tsk-1", status: "completada", motivo: "ignorado" });
    expect(res.ok).toBe(true);
    expect(port.statuses).toEqual([{ id: "tsk-1", status: "completada", motivo: null }]);
  });
});

describe("connect/application · Assign / Priority / Due / Follow / Thread / Workflow", () => {
  it("assign acepta devolución (toProfileId null)", async () => {
    const port = new FakeTaskPort();
    const res = await new AssignTaskUseCase(port).execute({ taskId: "tsk-1", toProfileId: null });
    expect(res.ok).toBe(true);
    expect(port.assigned).toEqual([{ id: "tsk-1", to: null }]);
  });

  it("assign exige tarea", async () => {
    const port = new FakeTaskPort();
    const res = await new AssignTaskUseCase(port).execute({ taskId: "", toProfileId: "u-1" });
    expect(res.ok).toBe(false);
    expect(port.assigned).toHaveLength(0);
  });

  it("setPriority valida el enum", async () => {
    const port = new FakeTaskPort();
    expect((await new SetTaskPriorityUseCase(port).execute({ taskId: "t", priority: "maxima" })).ok).toBe(false);
    expect((await new SetTaskPriorityUseCase(port).execute({ taskId: "t", priority: "urgente" })).ok).toBe(true);
    expect(port.priorities).toEqual([{ id: "t", p: "urgente" }]);
  });

  it("setDue valida fecha y acepta null (quitar fecha)", async () => {
    const port = new FakeTaskPort();
    expect((await new SetTaskDueUseCase(port).execute({ taskId: "t", dueAt: "no-fecha" })).ok).toBe(false);
    expect((await new SetTaskDueUseCase(port).execute({ taskId: "t", dueAt: null })).ok).toBe(true);
    expect((await new SetTaskDueUseCase(port).execute({ taskId: "t", dueAt: "2026-07-03T12:00:00.000Z" })).ok).toBe(true);
    expect(port.dues).toHaveLength(2);
  });

  it("follow / ensureThread / instantiateWorkflow pasan al puerto", async () => {
    const port = new FakeTaskPort();
    expect((await new FollowTaskUseCase(port).execute({ taskId: "t", userId: "u", follow: true })).ok).toBe(true);
    const thread = await new EnsureTaskThreadUseCase(port).execute({ taskId: "t" });
    expect(thread.ok).toBe(true);
    if (thread.ok) expect(thread.value.conversationId).toBe("c-task-1");
    const wf = await new InstantiateWorkflowUseCase(port).execute({ templateId: "wft-1" });
    expect(wf.ok).toBe(true);
    if (wf.ok) expect(wf.value.taskPublicId).toBe("TSK-2026-0002");
  });
});
