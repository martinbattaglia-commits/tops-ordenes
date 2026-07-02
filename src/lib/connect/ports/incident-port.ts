// Nexus Link · puerto de escritura del Centro de Incidentes (F4.2).
// Contrato hexagonal: los use-cases dependen de esto; el driven adapter lo
// implementa vía las RPCs SECDEF de 0165 (RPC-first, G10).

import type { Result } from "../domain/result";
import type { IncidentSeverity, IncidentStatus } from "../types";

export interface OpenIncidentInput {
  titulo: string;
  severidad: IncidentSeverity;
  sector: string | null;
  ubicacion: string | null;
  tipoAveria: string | null;
  descripcion: string | null;
}

export interface OpenIncidentOutput {
  id: string;
  publicId: string;
  conversationId: string;
}

export interface IncidentWritePort {
  open(input: OpenIncidentInput): Promise<Result<OpenIncidentOutput>>;
  assign(incidentId: string, toProfileId: string): Promise<Result<void>>;
  setStatus(incidentId: string, status: IncidentStatus): Promise<Result<void>>;
  setSeverity(incidentId: string, severity: IncidentSeverity): Promise<Result<void>>;
  resolve(incidentId: string, resolution: string): Promise<Result<void>>;
}
