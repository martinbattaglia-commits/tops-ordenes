// Nexus Link · use-cases del Centro de Incidentes (F4.2). Sin Supabase directo:
// validación temprana de dominio + puerto inyectado (patrón use-cases.ts).
// La autoridad final es el RPC de 0165 (máquina de estados + permisos + audit).

import { err, domainError, type Result } from "../domain/result";
import {
  validateOpenInput, validateResolution,
} from "../domain/incident";
import type {
  IncidentWritePort, OpenIncidentInput, OpenIncidentOutput,
} from "../ports/incident-port";
import type { IncidentSeverity, IncidentStatus } from "../types";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "../types";

function clean(s: string | null | undefined, max: number): string | null {
  const t = (s ?? "").trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

export class OpenIncidentUseCase {
  constructor(private readonly port: IncidentWritePort) {}

  async execute(input: {
    titulo: string;
    severidad: string;
    sector?: string | null;
    ubicacion?: string | null;
    tipoAveria?: string | null;
    descripcion?: string | null;
  }): Promise<Result<OpenIncidentOutput>> {
    const v = validateOpenInput({ titulo: input.titulo, severidad: input.severidad });
    if (!v.ok) return err(domainError("invalid_input", v.message));
    const payload: OpenIncidentInput = {
      titulo: v.titulo,
      severidad: v.severidad,
      sector: clean(input.sector, 60),
      ubicacion: clean(input.ubicacion, 120),
      tipoAveria: clean(input.tipoAveria, 80),
      descripcion: clean(input.descripcion, 8000),
    };
    return this.port.open(payload);
  }
}

export class AssignIncidentUseCase {
  constructor(private readonly port: IncidentWritePort) {}

  async execute(input: { incidentId: string; toProfileId: string }): Promise<Result<void>> {
    if (!input.incidentId || !input.toProfileId) {
      return err(domainError("invalid_input", "Falta el incidente o el asignado."));
    }
    return this.port.assign(input.incidentId, input.toProfileId);
  }
}

export class SetIncidentStatusUseCase {
  constructor(private readonly port: IncidentWritePort) {}

  async execute(input: { incidentId: string; status: string }): Promise<Result<void>> {
    if (!(INCIDENT_STATUSES as readonly string[]).includes(input.status)) {
      return err(domainError("invalid_input", "Estado inválido."));
    }
    if (input.status === "resuelto") {
      // Invariante 0165: resolver SOLO por resolve (exige resolución).
      return err(domainError("invalid_input", "Para resolver, usá la acción Resolver (requiere detalle)."));
    }
    return this.port.setStatus(input.incidentId, input.status as IncidentStatus);
  }
}

export class SetIncidentSeverityUseCase {
  constructor(private readonly port: IncidentWritePort) {}

  async execute(input: { incidentId: string; severity: string }): Promise<Result<void>> {
    if (!(INCIDENT_SEVERITIES as readonly string[]).includes(input.severity)) {
      return err(domainError("invalid_input", "Severidad inválida."));
    }
    return this.port.setSeverity(input.incidentId, input.severity as IncidentSeverity);
  }
}

export class ResolveIncidentUseCase {
  constructor(private readonly port: IncidentWritePort) {}

  async execute(input: { incidentId: string; resolution: string }): Promise<Result<void>> {
    const v = validateResolution(input.resolution);
    if (!v.ok) return err(domainError("invalid_input", v.message));
    return this.port.resolve(input.incidentId, v.text);
  }
}
