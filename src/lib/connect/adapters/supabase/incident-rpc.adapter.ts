// Nexus Link · driven adapter (Supabase) del Centro de Incidentes (F4.2).
// Implementa IncidentWritePort invocando las RPCs SECDEF de 0165 POR SESIÓN:
// el RPC re-valida permisos (connect.create / connect.incident_admin), la máquina
// de estados y audita al usuario real. RPC-first (G10): NUNCA escribe tablas directo.

import { ok, err, domainError, type Result } from "../../domain/result";
import type {
  IncidentWritePort, OpenIncidentInput, OpenIncidentOutput,
} from "../../ports/incident-port";
import type { IncidentSeverity, IncidentStatus } from "../../types";
import type { RpcCapableClient } from "./connect-rpc.adapter";

/** Traduce errores Postgres de 0165 a mensaje humano. */
function mapIncidentPgError(message: string): string {
  if (/incidente inexistente/i.test(message)) return "El incidente no existe.";
  if (/está cerrado/i.test(message)) return "El incidente está cerrado (estado terminal).";
  if (/transición inválida/i.test(message)) return "Esa transición de estado no está permitida.";
  if (/cierre forzado/i.test(message)) return "Solo un administrador de incidentes puede forzar el cierre.";
  if (/incident_admin|solo el asignado|solo reportante|insufficient_privilege|permiso/i.test(message)) {
    return "No tenés permiso para esta acción sobre el incidente.";
  }
  if (/resolución es obligatoria/i.test(message)) return "La resolución es obligatoria.";
  if (/título .* obligatorio/i.test(message)) return "El título del incidente es obligatorio.";
  if (/no es un usuario interno/i.test(message)) return "El asignado no es un usuario interno válido.";
  if (/severidad inválida|estado inválido|check_violation/i.test(message)) return "Datos inválidos.";
  return message;
}

export class IncidentRpcAdapter implements IncidentWritePort {
  constructor(private readonly client: RpcCapableClient) {}

  async open(input: OpenIncidentInput): Promise<Result<OpenIncidentOutput>> {
    const { data, error } = await this.client.rpc("connect_incident_open", {
      p_titulo: input.titulo,
      p_severidad: input.severidad,
      p_sector: input.sector,
      p_ubicacion: input.ubicacion,
      p_tipo_averia: input.tipoAveria,
      p_descripcion: input.descripcion,
    });
    if (error) return err(domainError("rpc_error", mapIncidentPgError(error.message)));
    // returns table(id, public_id, conversation_id) → array de una fila.
    const row = Array.isArray(data)
      ? (data[0] as { id: string; public_id: string; conversation_id: string } | undefined)
      : null;
    if (!row) return err(domainError("rpc_error", "El alta no devolvió el incidente creado."));
    return ok({ id: row.id, publicId: row.public_id, conversationId: row.conversation_id });
  }

  async assign(incidentId: string, toProfileId: string): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_incident_assign", {
      p_id: incidentId,
      p_to: toProfileId,
    });
    if (error) return err(domainError("rpc_error", mapIncidentPgError(error.message)));
    return ok(undefined);
  }

  async setStatus(incidentId: string, status: IncidentStatus): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_incident_set_status", {
      p_id: incidentId,
      p_status: status,
    });
    if (error) return err(domainError("rpc_error", mapIncidentPgError(error.message)));
    return ok(undefined);
  }

  async setSeverity(incidentId: string, severity: IncidentSeverity): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_incident_set_severity", {
      p_id: incidentId,
      p_severidad: severity,
    });
    if (error) return err(domainError("rpc_error", mapIncidentPgError(error.message)));
    return ok(undefined);
  }

  async resolve(incidentId: string, resolution: string): Promise<Result<void>> {
    const { error } = await this.client.rpc("connect_incident_resolve", {
      p_id: incidentId,
      p_resolucion: resolution,
    });
    if (error) return err(domainError("rpc_error", mapIncidentPgError(error.message)));
    return ok(undefined);
  }
}
