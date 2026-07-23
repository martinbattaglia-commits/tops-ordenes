import { describe, it, expect } from "vitest";
import {
  OpenIncidentUseCase, AssignIncidentUseCase, SetIncidentStatusUseCase,
  SetIncidentSeverityUseCase, ResolveIncidentUseCase,
} from "./incident-use-cases";
import { ok, type Result } from "../domain/result";
import type {
  IncidentWritePort, OpenIncidentInput, OpenIncidentOutput,
} from "../ports/incident-port";
import type { IncidentSeverity, IncidentStatus } from "../types";

class FakeIncidentPort implements IncidentWritePort {
  public opened: OpenIncidentInput[] = [];
  public assigned: Array<{ id: string; to: string }> = [];
  public statuses: Array<{ id: string; status: IncidentStatus }> = [];
  public severities: Array<{ id: string; severity: IncidentSeverity }> = [];
  public resolved: Array<{ id: string; resolution: string }> = [];

  async open(input: OpenIncidentInput): Promise<Result<OpenIncidentOutput>> {
    this.opened.push(input);
    return ok({ id: "inc-1", publicId: "INC-2026-0001", conversationId: "c-inc-1" });
  }
  async assign(id: string, to: string): Promise<Result<void>> {
    this.assigned.push({ id, to });
    return ok(undefined);
  }
  async setStatus(id: string, status: IncidentStatus): Promise<Result<void>> {
    this.statuses.push({ id, status });
    return ok(undefined);
  }
  async setSeverity(id: string, severity: IncidentSeverity): Promise<Result<void>> {
    this.severities.push({ id, severity });
    return ok(undefined);
  }
  async resolve(id: string, resolution: string): Promise<Result<void>> {
    this.resolved.push({ id, resolution });
    return ok(undefined);
  }
}

describe("connect/application · OpenIncidentUseCase", () => {
  it("rechaza título vacío sin llegar al puerto", async () => {
    const port = new FakeIncidentPort();
    const res = await new OpenIncidentUseCase(port).execute({ titulo: "   ", severidad: "media" });
    expect(res.ok).toBe(false);
    expect(port.opened).toHaveLength(0);
  });

  it("rechaza severidad inválida sin llegar al puerto", async () => {
    const port = new FakeIncidentPort();
    const res = await new OpenIncidentUseCase(port).execute({ titulo: "Avería", severidad: "urgente" });
    expect(res.ok).toBe(false);
    expect(port.opened).toHaveLength(0);
  });

  it("normaliza campos (trim, vacíos → null) y postea", async () => {
    const port = new FakeIncidentPort();
    const res = await new OpenIncidentUseCase(port).execute({
      titulo: "  Avería montacargas  ",
      severidad: "alta",
      sector: "  D4 ",
      ubicacion: "   ",
      descripcion: " No enciende. ",
    });
    expect(res.ok).toBe(true);
    expect(port.opened).toHaveLength(1);
    expect(port.opened[0].titulo).toBe("Avería montacargas");
    expect(port.opened[0].sector).toBe("D4");
    expect(port.opened[0].ubicacion).toBeNull();
    expect(port.opened[0].tipoAveria).toBeNull();
    expect(port.opened[0].descripcion).toBe("No enciende.");
    if (res.ok) expect(res.value.publicId).toBe("INC-2026-0001");
  });
});

describe("connect/application · SetIncidentStatusUseCase", () => {
  it("rechaza estados fuera del enum", async () => {
    const port = new FakeIncidentPort();
    const res = await new SetIncidentStatusUseCase(port).execute({ incidentId: "inc-1", status: "pausado" });
    expect(res.ok).toBe(false);
    expect(port.statuses).toHaveLength(0);
  });

  it("rechaza 'resuelto' (invariante 0165: resolver exige detalle vía resolve)", async () => {
    const port = new FakeIncidentPort();
    const res = await new SetIncidentStatusUseCase(port).execute({ incidentId: "inc-1", status: "resuelto" });
    expect(res.ok).toBe(false);
    expect(port.statuses).toHaveLength(0);
  });

  it("pasa transiciones válidas al puerto", async () => {
    const port = new FakeIncidentPort();
    const res = await new SetIncidentStatusUseCase(port).execute({ incidentId: "inc-1", status: "en_progreso" });
    expect(res.ok).toBe(true);
    expect(port.statuses).toEqual([{ id: "inc-1", status: "en_progreso" }]);
  });
});

describe("connect/application · ResolveIncidentUseCase", () => {
  it("rechaza resolución vacía sin llegar al puerto", async () => {
    const port = new FakeIncidentPort();
    const res = await new ResolveIncidentUseCase(port).execute({ incidentId: "inc-1", resolution: "   " });
    expect(res.ok).toBe(false);
    expect(port.resolved).toHaveLength(0);
  });

  it("trimmea y resuelve", async () => {
    const port = new FakeIncidentPort();
    const res = await new ResolveIncidentUseCase(port).execute({
      incidentId: "inc-1", resolution: "  Se reemplazó el contactor.  ",
    });
    expect(res.ok).toBe(true);
    expect(port.resolved).toEqual([{ id: "inc-1", resolution: "Se reemplazó el contactor." }]);
  });
});

describe("connect/application · Assign / SetSeverity", () => {
  it("assign exige incidente y destinatario", async () => {
    const port = new FakeIncidentPort();
    const res = await new AssignIncidentUseCase(port).execute({ incidentId: "", toProfileId: "u-1" });
    expect(res.ok).toBe(false);
    expect(port.assigned).toHaveLength(0);
  });

  it("assign pasa al puerto", async () => {
    const port = new FakeIncidentPort();
    const res = await new AssignIncidentUseCase(port).execute({ incidentId: "inc-1", toProfileId: "u-1" });
    expect(res.ok).toBe(true);
    expect(port.assigned).toEqual([{ id: "inc-1", to: "u-1" }]);
  });

  it("setSeverity valida el enum", async () => {
    const port = new FakeIncidentPort();
    const bad = await new SetIncidentSeverityUseCase(port).execute({ incidentId: "inc-1", severity: "maxima" });
    expect(bad.ok).toBe(false);
    const good = await new SetIncidentSeverityUseCase(port).execute({ incidentId: "inc-1", severity: "critica" });
    expect(good.ok).toBe(true);
    expect(port.severities).toEqual([{ id: "inc-1", severity: "critica" }]);
  });
});
