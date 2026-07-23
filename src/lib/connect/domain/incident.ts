// Nexus Link · dominio — Centro de Incidentes (F4.2). PURO, sin I/O.
// Espeja la máquina de estados de 0165 (fuente de verdad = RPC; esto es UX:
// qué acciones ofrecer y validación temprana — el server SIEMPRE re-valida).
//
//   abierto → en_progreso → en_espera ↔ en_progreso → resuelto → cerrado
//   reapertura: resuelto → en_progreso (auditada) · cierre forzado: solo admin
//   'resuelto' NO se alcanza por set_status (solo resolve, exige resolución).

import type { Incident, IncidentSeverity, IncidentStatus } from "../types";
import { INCIDENT_SEVERITIES } from "../types";

export const MAX_INCIDENT_TITLE = 160;
export const MAX_RESOLUTION = 2000;

/** Quién es el viewer respecto del incidente (resuelto por el caller). */
export interface IncidentViewer {
  userId: string | null;
  /** has_permission('connect.incident_admin') */
  isIncidentAdmin: boolean;
}

export function isAssignee(i: Incident, v: IncidentViewer): boolean {
  return v.userId != null && i.asignadoA != null && i.asignadoA === v.userId;
}

export function isReporter(i: Incident, v: IncidentViewer): boolean {
  return v.userId != null && i.reportadoPor != null && i.reportadoPor === v.userId;
}

/** Acciones de ciclo de vida que la UI puede ofrecer. */
export type IncidentAction =
  | "start"        // abierto → en_progreso
  | "hold"         // en_progreso → en_espera
  | "resume"       // en_espera → en_progreso
  | "resolve"      // (abierto|en_progreso|en_espera) → resuelto (RPC resolve)
  | "close"        // resuelto → cerrado
  | "reopen"       // resuelto → en_progreso
  | "force_close"  // (abierto|en_progreso|en_espera) → cerrado (solo admin)
  | "assign_self"  // auto-asignación
  | "assign"       // asignar a terceros (solo admin)
  | "set_severity";

/** Estado destino de cada acción de transición (para armar el payload del action). */
export const ACTION_TARGET_STATUS: Partial<Record<IncidentAction, IncidentStatus>> = {
  start: "en_progreso",
  hold: "en_espera",
  resume: "en_progreso",
  close: "cerrado",
  reopen: "en_progreso",
  force_close: "cerrado",
};

/**
 * Acciones disponibles para el viewer según estado y rol (espejo UX de 0165).
 * El orden es el orden sugerido de render.
 */
export function availableActions(i: Incident, v: IncidentViewer): IncidentAction[] {
  const admin = v.isIncidentAdmin;
  const assignee = isAssignee(i, v);
  const reporter = isReporter(i, v);
  const canWork = admin || assignee;
  const out: IncidentAction[] = [];

  if (i.estado === "cerrado") return out; // terminal

  // Asignación (atributo, no estado — D4). Fix I-1/I-3 adversarial: la
  // auto-asignación es un "claim" SOLO de incidentes VACANTES (el RPC exige
  // asignado_a null para no-admins; reasignar — incluso a uno mismo — es de admin).
  if (admin) out.push("assign");
  if (i.asignadoA == null && v.userId != null) out.push("assign_self");

  switch (i.estado) {
    case "abierto":
      if (canWork) out.push("start", "resolve");
      if (admin) out.push("force_close");
      break;
    case "en_progreso":
      if (canWork) out.push("hold", "resolve");
      if (admin) out.push("force_close");
      break;
    case "en_espera":
      if (canWork) out.push("resume", "resolve");
      if (admin) out.push("force_close");
      break;
    case "resuelto":
      if (reporter || assignee || admin) out.push("close", "reopen");
      break;
  }

  if (canWork) out.push("set_severity");
  return out;
}

/** Validación temprana del alta (el RPC re-valida). */
export function validateOpenInput(input: {
  titulo: string;
  severidad: string;
}): { ok: true; titulo: string; severidad: IncidentSeverity } | { ok: false; message: string } {
  const titulo = input.titulo.trim();
  if (titulo.length === 0) return { ok: false, message: "El título del incidente es obligatorio." };
  if (titulo.length > MAX_INCIDENT_TITLE) {
    return { ok: false, message: `El título no puede superar ${MAX_INCIDENT_TITLE} caracteres.` };
  }
  if (!(INCIDENT_SEVERITIES as readonly string[]).includes(input.severidad)) {
    return { ok: false, message: "Severidad inválida." };
  }
  return { ok: true, titulo, severidad: input.severidad as IncidentSeverity };
}

/** Validación temprana de la resolución (el RPC re-valida). */
export function validateResolution(text: string): { ok: true; text: string } | { ok: false; message: string } {
  const t = text.trim();
  if (t.length === 0) return { ok: false, message: "La resolución es obligatoria." };
  if (t.length > MAX_RESOLUTION) {
    return { ok: false, message: `La resolución no puede superar ${MAX_RESOLUTION} caracteres.` };
  }
  return { ok: true, text: t };
}

/** Orden por severidad (crítica primero) y antigüedad — para la lista de gestión. */
export function severityRank(s: IncidentSeverity): number {
  switch (s) {
    case "critica": return 0;
    case "alta": return 1;
    case "media": return 2;
    case "baja": return 3;
  }
}

/** Estados "vivos" (lista por defecto). */
export function isOpenStatus(s: IncidentStatus): boolean {
  return s !== "resuelto" && s !== "cerrado";
}
