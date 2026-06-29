/**
 * Motor de semáforo de Compliance.
 * REGLA CLAVE (D7): el color surge SÓLO de (temporal + estado administrativo).
 * El nivel de riesgo NO interviene en el color: se usa para prioridad (alertSeverity).
 */
import type { Semaforo, EstadoAdministrativo, Temporal, NivelRiesgo } from "./cases/types";

/** Jerarquía D6: override del ítem → config por frecuencia → default del sistema. */
export function resolveAnticipacion(args: {
  itemOverride: number | null;
  frecuencia: string | null;
  config: Record<string, number>;
}): number {
  if (args.itemOverride != null) return args.itemOverride;
  const f = (args.frecuencia ?? "").trim();
  if (f && args.config[f] != null) return args.config[f];
  return args.config["__default__"] ?? 60;
}

export function temporalOf(args: {
  vencimiento: string | null;
  dias: number | null;
  baseFalta: boolean;
  anticipacion?: number;
}): Temporal {
  if (!args.vencimiento || args.dias == null) return args.baseFalta ? "falta" : "sin_fecha";
  if (args.dias < 0) return "vencido";
  const antic = args.anticipacion ?? 60;
  return args.dias <= antic ? "proximo" : "vigente";
}

/** Cascada de color (spec §5.2). NO recibe riesgo. */
export function computeSemaforo(temporal: Temporal, estado: EstadoAdministrativo): Semaforo {
  if (temporal === "vigente") {
    if (estado === "rechazado") return "Rojo";
    if (estado === "observado" || estado === "pendiente_emision") return "Amarillo";
    return "Verde";
  }
  if (temporal === "proximo") {
    if (estado === "rechazado") return "Rojo";
    return "Amarillo";
  }
  if (temporal === "vencido" || temporal === "falta") {
    if (estado === "en_tramite" || estado === "observado") return "Naranja";
    if (estado === "pendiente_emision" || estado === "aprobado") return "Amarillo";
    if (estado === "rechazado") return "Rojo";
    return "Rojo";
  }
  // sin_fecha (permanente)
  if (estado === "en_tramite") return "Naranja";
  if (estado === "observado" || estado === "pendiente_emision" || estado === "aprobado") return "Amarillo";
  if (estado === "rechazado") return "Rojo";
  return "Verde";
}

/** Severidad de alerta a partir del riesgo (prioridad) y el color. */
export function alertSeverity(nivel: NivelRiesgo | null, semaforo: Semaforo): "critical" | "warning" | "info" {
  if (semaforo === "Verde") return "info";
  if (nivel === "critico") return "critical";
  if (semaforo === "Rojo") return "critical";
  if (nivel === "alto") return "warning";
  return "warning";
}
